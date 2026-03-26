import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenClawAgentSdk, type OpenClawStreamEvent } from "../../src/index.js";

async function collect(stream: AsyncIterable<OpenClawStreamEvent>): Promise<OpenClawStreamEvent[]> {
  const events: OpenClawStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe("plugins and tool policy", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses allowlisted plugin mode and blocks denied embedded tool families", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-sdk-tools-"));
    tempDirs.push(root);

    const sdk = await createOpenClawAgentSdk({
      workspaceDir: path.join(root, "workspace"),
      stateDir: path.join(root, "state"),
      agentDir: path.join(root, "agent"),
      profileId: "default",
      pluginMode: "allowlisted",
      enabledPluginIds: ["builtin-web-search"],
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
          return path.join(root, "state", "session.jsonl");
        },
      },
      hostedTools: [
        {
          name: "gateway",
          description: "forbidden in embedded mode",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "finish",
          description: "allowed in embedded mode",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });

    const session = sdk.createSession({
      identity: {
        mode: "general",
        sessionId: "sess-general",
        sessionKey: "visionclaw:default:general",
      },
      systemPrompt: "Only use tools allowed in embedded mode.",
      modelRef: "openai/gpt-5.4",
      sessionFile: path.join(root, "state", "session.jsonl"),
    });

    const deniedTurn = await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "gateway now" }],
      }),
    );
    expect(deniedTurn.some((event) => event.kind === "hosted_tool_call")).toBe(false);

    const allowedTurn = await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "finish now" }],
      }),
    );
    expect(
      allowedTurn.some(
        (event) => event.kind === "hosted_tool_call" && event.toolName === "finish",
      ),
    ).toBe(true);

    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(import.meta.dirname, "../..", "package.json"), "utf-8"),
    ) as {
      exports?: Record<string, unknown>;
    };
    expect(packageJson.exports?.["./plugin-sdk"]).toBeDefined();

    await sdk.shutdown();
  });
});
