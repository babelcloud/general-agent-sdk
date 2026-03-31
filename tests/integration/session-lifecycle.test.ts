import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createGeneralAgentSdk,
  type GeneralAgentStoredSession,
  type GeneralAgentStreamEvent,
} from "../../src/index.js";

async function collect(
  stream: AsyncIterable<GeneralAgentStreamEvent>,
): Promise<GeneralAgentStreamEvent[]> {
  const out: GeneralAgentStreamEvent[] = [];
  for await (const event of stream) {
    out.push(event);
  }
  return out;
}

function createSessionStore(root: string) {
  const sessionsByKey = new Map<string, GeneralAgentStoredSession>();

  return {
    async load(identity: { sessionKey: string }) {
      return structuredClone(sessionsByKey.get(identity.sessionKey) ?? null);
    },
    async save(identity: { sessionKey: string }, value: GeneralAgentStoredSession) {
      sessionsByKey.set(identity.sessionKey, structuredClone(value));
    },
    async resolveSessionFile(identity: { sessionId: string }) {
      return path.join(root, "state", "transcripts", `${identity.sessionId}.jsonl`);
    },
  };
}

describe("session lifecycle", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists sessions, reads history, and continues or resumes a stored session", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-session-"));
    tempDirs.push(root);
    const sessionStore = createSessionStore(root);

    const hostedTools = [
      {
        name: "finish",
        description: "finish the task",
        inputSchema: { type: "object", properties: {} },
      },
    ];

    const sdk = await createGeneralAgentSdk({
      workspaceDir: path.join(root, "workspace"),
      stateDir: path.join(root, "state"),
      agentDir: path.join(root, "agent"),
      profileId: "default",
      pluginMode: "disabled",
      logger: {
        onDebug() {},
        onInfo() {},
        onWarn() {},
        onError() {},
      },
      sessionStore,
      hostedTools,
    });

    const session = sdk.createSession({
      identity: {
        mode: "general",
        sessionId: "sess-lifecycle",
        sessionKey: "host:default:sess-lifecycle",
      },
      systemPrompt: "Be precise.",
      modelRef: "openai/gpt-5.4",
      sessionFile: path.join(root, "state", "transcripts", "sess-lifecycle.jsonl"),
    });

    const firstTurnEvents = await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "first finish turn" }],
      }),
    );

    // Complete the hosted-tool turn so session state is clean for resume
    const hostedToolCall = firstTurnEvents.find(
      (e) => e.kind === "hosted_tool_call" && e.toolName === "finish",
    );
    if (hostedToolCall && hostedToolCall.kind === "hosted_tool_call") {
      await collect(
        session.submitHostedToolResult({
          callId: hostedToolCall.callId,
          output: { ok: true },
          details: { source: "test" },
        }),
      );
    }

    const sessions = await sdk.listSessions();
    expect(sessions).toEqual([
      expect.objectContaining({
        sessionId: "sess-lifecycle",
        sessionKey: "host:default:sess-lifecycle",
        mode: "general",
        modelRef: "openai/gpt-5.4",
        systemPrompt: "Be precise.",
      }),
    ]);

    const history = await sdk.readSessionHistory("sess-lifecycle");
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "system_prompt", prompt: "Be precise." }),
        expect.objectContaining({ type: "message", role: "user" }),
        expect.objectContaining({ type: "tool_call", toolName: "finish" }),
      ]),
    );

    await sdk.shutdown();

    const resumedSdk = await createGeneralAgentSdk({
      workspaceDir: path.join(root, "workspace"),
      stateDir: path.join(root, "state"),
      agentDir: path.join(root, "agent"),
      profileId: "default",
      pluginMode: "disabled",
      logger: {
        onDebug() {},
        onInfo() {},
        onWarn() {},
        onError() {},
      },
      sessionStore,
      hostedTools,
    });

    const continued = await resumedSdk.continueSession({
      identity: {
        mode: "general",
        sessionId: "sess-lifecycle",
        sessionKey: "host:default:sess-lifecycle",
      },
    });
    const resumed = await resumedSdk.resumeSession("sess-lifecycle");

    expect(continued.getSessionId()).toBe("sess-lifecycle");
    expect(resumed.getSessionId()).toBe("sess-lifecycle");
    expect(continued.getTranscriptPath()).toBe(
      path.join(root, "state", "transcripts", "sess-lifecycle.jsonl"),
    );
    expect(resumed.getTranscriptPath()).toBe(
      path.join(root, "state", "transcripts", "sess-lifecycle.jsonl"),
    );

    await collect(
      resumed.streamTurn({
        role: "user",
        content: [{ type: "text", text: "second finish turn" }],
      }),
    );

    const updatedHistory = await resumedSdk.readSessionHistory("sess-lifecycle");
    expect(
      updatedHistory.filter(
        (entry) => entry.type === "message" && entry.content.some((part) => part.type === "text"),
      ),
    ).toHaveLength(2);

    await resumedSdk.shutdown();
  });

  it("forks a stored session into a new transcript without mutating the source history", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-fork-"));
    tempDirs.push(root);
    const sessionStore = createSessionStore(root);

    const sdk = await createGeneralAgentSdk({
      workspaceDir: path.join(root, "workspace"),
      stateDir: path.join(root, "state"),
      agentDir: path.join(root, "agent"),
      profileId: "default",
      pluginMode: "disabled",
      logger: {
        onDebug() {},
        onInfo() {},
        onWarn() {},
        onError() {},
      },
      sessionStore,
      hostedTools: [
        {
          name: "finish",
          description: "finish the task",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });

    const sourceSession = sdk.createSession({
      identity: {
        mode: "general",
        sessionId: "sess-source",
        sessionKey: "host:default:sess-source",
      },
      systemPrompt: "Source prompt.",
      modelRef: "openai/gpt-5.4",
      sessionFile: path.join(root, "state", "transcripts", "sess-source.jsonl"),
    });

    await collect(
      sourceSession.streamTurn({
        role: "user",
        content: [{ type: "text", text: "finish to seed source history" }],
      }),
    );

    const sourceHistory = await sdk.readSessionHistory("sess-source");

    const forked = await sdk.forkSession("sess-source", {
      identity: {
        mode: "general",
        sessionId: "sess-fork",
        sessionKey: "host:default:sess-fork",
      },
      sessionFile: path.join(root, "state", "transcripts", "sess-fork.jsonl"),
    });

    expect(forked.getSessionId()).toBe("sess-fork");

    const forkHistory = await sdk.readSessionHistory("sess-fork");
    expect(forkHistory).toEqual(sourceHistory);

    await collect(
      forked.streamTurn({
        role: "user",
        content: [{ type: "text", text: "finish fork only turn" }],
      }),
    );

    const sourceHistoryAfter = await sdk.readSessionHistory("sess-source");
    const forkHistoryAfter = await sdk.readSessionHistory("sess-fork");

    expect(sourceHistoryAfter).toEqual(sourceHistory);
    expect(forkHistoryAfter.length).toBeGreaterThan(sourceHistory.length);

    await sdk.shutdown();
  });
});
