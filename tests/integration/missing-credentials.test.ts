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

describe("missing credentials", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not silently produce fake assistant responses when no API key is provided", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-no-key-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "no-key.jsonl");

    // Create SDK WITHOUT an anthropicApiKey — no key at SDK level or session level
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
      // No hostedTools — so there's no hosted-tool fallback path either
      hostedTools: [],
      // Explicitly no anthropicApiKey
    });

    const session = sdk.createSession({
      identity: {
        mode: "general",
        sessionId: "sess-no-key",
        sessionKey: "host:default:no-key",
      },
      systemPrompt: "You are a helpful assistant.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
      // No anthropicApiKey at session level either
    });

    // Per §16: when no API key is provided and no hosted-tool path is available,
    // the SDK must throw an explicit error — not silently produce a fake response.
    await expect(
      collect(
        session.streamTurn({
          role: "user",
          content: [{ type: "text", text: "What is the capital of France?" }],
        }),
      ),
    ).rejects.toThrow(/No API key provided/);

    await sdk.shutdown();
  });

  it("routes to hosted-tool path (non-silent) when tool name appears in input and no API key", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-no-key-hosted-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "no-key-hosted.jsonl");

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
      // No anthropicApiKey
    });

    const session = sdk.createSession({
      identity: {
        mode: "general",
        sessionId: "sess-no-key-hosted",
        sessionKey: "host:default:no-key-hosted",
      },
      systemPrompt: "Use the finish tool.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    // When input text contains a hosted tool name and no API key is available,
    // the SDK falls through to the hosted-tool detection path. This is a
    // non-silent, explicit delegation — the caller gets a hosted_tool_call
    // event and must provide a result. This path is acceptable per §16
    // because it does NOT pretend the LLM responded.
    const events = await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "please finish now" }],
      }),
    );

    // The hosted-tool path emits tool_call + hosted_tool_call — no fake assistant_delta
    const assistantDeltas = events.filter((e) => e.kind === "assistant_delta");
    expect(assistantDeltas).toHaveLength(0);

    const hostedToolCall = events.find(
      (e): e is Extract<GeneralAgentStreamEvent, { kind: "hosted_tool_call" }> =>
        e.kind === "hosted_tool_call",
    );
    expect(hostedToolCall).toBeDefined();
    expect(hostedToolCall!.toolName).toBe("finish");

    await sdk.shutdown();
  });
});
