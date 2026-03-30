import { describe, expect, it } from "vitest";
import { createGeneralAgentAgentSdk } from "../../src/index.js";
import { createVisionClawSessionAdapter } from "../../src/compat/visionclaw/index.js";

describe("VisionClaw compat session adapter", () => {
  it("preserves hosted-tool tool_use -> tool_result continuity without renaming exec", async () => {
    const sdk = await createGeneralAgentAgentSdk({
      workspaceDir: "/tmp/general-agent-sdk-workspace",
      stateDir: "/tmp/general-agent-sdk-state",
      agentDir: "/tmp/general-agent-sdk-agent",
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
          return "/tmp/general-agent-sdk-state/general.jsonl";
        },
      },
      hostedTools: [
        {
          name: "exec",
          description: "Run a host command",
          inputSchema: {},
        },
      ],
    });

    const session = createVisionClawSessionAdapter({
      sdk,
      sessionParams: {
        identity: {
          mode: "general",
          sessionId: "sess-general",
          sessionKey: "visionclaw:default:general",
        },
        systemPrompt: "Use exec when asked.",
        modelRef: "openai/gpt-5.4",
        sessionFile: "/tmp/general-agent-sdk-state/general.jsonl",
      },
      hostedToolExecutor: {
        async execute(toolName, input) {
          return { ok: true, output: { toolName, input } };
        },
      },
    });

    const chunks = [];
    for await (const chunk of session.sendAndStream("please exec")) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toMatchObject({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "exec" }],
      },
    });
    expect(chunks[1]).toMatchObject({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            content: { toolName: "exec", input: {} },
          },
        ],
      },
    });

    await sdk.shutdown();
  });
});
