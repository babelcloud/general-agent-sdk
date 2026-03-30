import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGeneralAgentAgentSdk, type GeneralAgentLogEvent } from "../../src/index.js";

describe("persistence and logging", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps session/log paths under host roots and emits one canonical system_prompt log", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-host-"));
    tempDirs.push(root);
    const logEvents: GeneralAgentLogEvent[] = [];
    const rawEvents: Record<string, unknown>[] = [];
    const sessionFile = path.join(
      root,
      "profile",
      "providers",
      "general-agent",
      "transcripts",
      "general",
      "sess-general.jsonl",
    );

    const sdk = await createGeneralAgentAgentSdk({
      workspaceDir: path.join(root, "workspace"),
      stateDir: path.join(root, "profile"),
      agentDir: path.join(root, "profile", "providers", "general-agent", "embedded"),
      profileId: "default",
      pluginMode: "disabled",
      logger: {
        onDebug(event) {
          logEvents.push(event);
        },
        onInfo(event) {
          logEvents.push(event);
        },
        onWarn(event) {
          logEvents.push(event);
        },
        onError(event) {
          logEvents.push(event);
        },
        onRawStreamEvent(event) {
          rawEvents.push(event);
        },
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
      hostedTools: [],
    });

    const rawEventLogPath = path.join(
      root,
      "profile",
      "providers",
      "general-agent",
      "raw-stream",
      "2026-03-27.jsonl",
    );

    const session = sdk.createSession({
      identity: {
        mode: "general",
        sessionId: "sess-general",
        sessionKey: "visionclaw:default:general",
      },
      systemPrompt: "system prompt line 1\nline 2",
      modelRef: "openai/gpt-5.4",
      sessionFile,
      rawEventLogPath,
    });

    for await (const _event of session.streamTurn({
      role: "user",
      content: [{ type: "text", text: "say hello" }],
    })) {
      // drain
    }

    const promptLogs = logEvents.filter((event) => event.category === "system_prompt");
    expect(promptLogs).toHaveLength(1);
    expect(promptLogs[0]?.message).toContain("\\n");
    expect(session.getTranscriptPath()).toBe(sessionFile);
    expect(session.getTranscriptPath()?.includes(".general-agent")).toBe(false);
    expect(rawEvents.length).toBeGreaterThanOrEqual(0);
    expect(fs.existsSync(rawEventLogPath)).toBe(true);

    await sdk.shutdown();
  });
});
