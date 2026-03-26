import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenClawAgentSdk, type OpenClawStreamEvent } from "../../src/index.js";

async function collect(stream: AsyncIterable<OpenClawStreamEvent>): Promise<OpenClawStreamEvent[]> {
  const out: OpenClawStreamEvent[] = [];
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-sdk-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "general.jsonl");

    const sdk = await createOpenClawAgentSdk({
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
        sessionKey: "visionclaw:default:general",
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
      (event): event is Extract<OpenClawStreamEvent, { kind: "hosted_tool_call" }> =>
        event.kind === "hosted_tool_call",
    );
    expect(hosted).toBeDefined();

    const resumed = await collect(
      session.submitHostedToolResult({
        callId: hosted!.callId,
        output: { ok: true },
      }),
    );

    expect(resumed.some((event) => event.kind === "turn_complete")).toBe(true);
    const transcript = fs.readFileSync(sessionFile, "utf-8");
    expect(transcript).toContain("\"role\":\"user\"");
    await sdk.shutdown();
  });
});
