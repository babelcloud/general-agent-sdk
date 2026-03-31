import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGeneralAgentSdk, type GeneralAgentStreamEvent } from "../../src/index.js";

async function collect(stream: AsyncIterable<GeneralAgentStreamEvent>): Promise<GeneralAgentStreamEvent[]> {
  const out: GeneralAgentStreamEvent[] = [];
  for await (const event of stream) {
    out.push(event);
  }
  return out;
}

describe("standalone session", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("streams one hosted tool call and resumes it with the same callId", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "general.jsonl");

    const sdk = await createGeneralAgentSdk({
      workspaceDir: root,
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
      sessionStore: {
        async load() {
          return null;
        },
        async save() {},
        async resolveSessionFile() {
          return sessionFile;
        },
      },
      hostedTools: [
        {
          name: "finish",
          description: "finish the task",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });

    const session = sdk.createSession({
      identity: {
        mode: "general",
        sessionId: "sess-general",
        sessionKey: "host:default:general",
      },
      systemPrompt: "Use the finish tool immediately.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    const firstTurn = await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "finish now" }],
      }),
    );

    const hosted = firstTurn.find(
      (event): event is Extract<GeneralAgentStreamEvent, { kind: "hosted_tool_call" }> =>
        event.kind === "hosted_tool_call",
    );
    expect(hosted).toBeDefined();

    const resumed = await collect(
      session.submitHostedToolResult({
        callId: hosted!.callId,
        output: { ok: true },
        details: { completionSource: "host", ok: true },
      }),
    );

    expect(resumed).toContainEqual({
      kind: "tool_result",
      callId: hosted!.callId,
      toolName: "finish",
      output: [{ type: "text", text: JSON.stringify({ ok: true }) }],
      details: { completionSource: "host", ok: true },
      isError: undefined,
    });
    expect(resumed.some((event) => event.kind === "turn_complete")).toBe(true);
    const transcript = fs
      .readFileSync(sessionFile, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(transcript.some((entry) => entry.role === "user")).toBe(true);
    expect(transcript).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        callId: hosted!.callId,
        toolName: "finish",
        output: [{ type: "text", text: JSON.stringify({ ok: true }) }],
        details: { completionSource: "host", ok: true },
      }),
    );
    await sdk.shutdown();
  });

  it("rejects starting a new turn while hosted tool input is still pending", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-pending-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "pending.jsonl");

    const sdk = await createGeneralAgentSdk({
      workspaceDir: root,
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
      sessionStore: {
        async load() {
          return null;
        },
        async save() {},
        async resolveSessionFile() {
          return sessionFile;
        },
      },
      hostedTools: [
        {
          name: "finish",
          description: "finish the task",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });

    const session = sdk.createSession({
      identity: {
        mode: "general",
        sessionId: "sess-pending",
        sessionKey: "host:default:pending",
      },
      systemPrompt: "Use the finish tool immediately.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    const firstTurn = await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "finish now" }],
      }),
    );

    expect(firstTurn.some((event) => event.kind === "hosted_tool_call")).toBe(true);
    await expect(
      collect(
        session.streamTurn({
          role: "user",
          content: [{ type: "text", text: "second turn" }],
        }),
      ),
    ).rejects.toThrow(/cannot start a new turn/i);

    await sdk.shutdown();
  });
});
