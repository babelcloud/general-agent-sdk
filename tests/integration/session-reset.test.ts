import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GeneralAgentHookRegistration,
  GeneralAgentStreamEvent,
} from "../../src/index.js";

async function collect(
  stream: AsyncIterable<GeneralAgentStreamEvent>,
): Promise<GeneralAgentStreamEvent[]> {
  const events: GeneralAgentStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe("session reset", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.clearAllMocks();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("clears transcript file and fires before_reset hook", async () => {
    const beforeResetEvents: Array<Record<string, unknown>> = [];
    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-reset-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "reset-test.jsonl");

    const hooks: GeneralAgentHookRegistration[] = [
      {
        pluginId: "test-before-reset",
        hookName: "before_reset",
        handler: (event) => {
          beforeResetEvents.push(event as unknown as Record<string, unknown>);
        },
      },
    ];

    const sdk = await createGeneralAgentSdk({
      workspaceDir: root,
      stateDir: path.join(root, "state"),
      agentDir: path.join(root, "agent"),
      profileId: "default",
      pluginMode: "disabled",
      hooks,
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
        sessionId: "reset-test",
        sessionKey: "test:reset",
      },
      systemPrompt: "You are helpful.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    // Run a turn so there's content in the transcript (no API key = hosted-tool fallback path)
    await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "first finish turn" }],
      }),
    );

    // Transcript should have content after a turn
    const contentBeforeReset = fs.readFileSync(sessionFile, "utf-8");
    expect(contentBeforeReset).toContain("first finish turn");

    // Reset should fire the hook and clear the transcript
    await session.reset("test_reason");

    expect(beforeResetEvents).toHaveLength(1);
    expect(beforeResetEvents[0]).toMatchObject({
      reason: "test_reason",
      sessionFile,
    });

    // Transcript file should be empty after reset
    const contentAfterReset = fs.readFileSync(sessionFile, "utf-8");
    expect(contentAfterReset).toBe("");

    // Usage snapshot should be null after reset
    expect(session.getUsageSnapshot()).toBeNull();

    await sdk.shutdown();
  });

  it("allows a new turn after reset", async () => {
    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-reset-resume-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "reset-resume-test.jsonl");

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
        sessionId: "reset-resume-test",
        sessionKey: "test:reset-resume",
      },
      systemPrompt: "You are helpful.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    // First turn
    await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "first finish turn" }],
      }),
    );

    expect(fs.readFileSync(sessionFile, "utf-8")).toContain("first finish turn");

    // Reset
    await session.reset("manual");

    expect(fs.readFileSync(sessionFile, "utf-8")).toBe("");

    // Second turn after reset — should succeed without throwing
    await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "second finish turn" }],
      }),
    );

    const transcriptAfterSecondTurn = fs.readFileSync(sessionFile, "utf-8");
    expect(transcriptAfterSecondTurn).toContain("second finish turn");
    expect(transcriptAfterSecondTurn).not.toContain("first finish turn");

    await sdk.shutdown();
  });

  it("defaults reason to 'manual' when not provided", async () => {
    const capturedReasons: Array<string | undefined> = [];
    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-reset-default-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "reset-default-test.jsonl");

    const sdk = await createGeneralAgentSdk({
      workspaceDir: root,
      stateDir: path.join(root, "state"),
      agentDir: path.join(root, "agent"),
      profileId: "default",
      pluginMode: "disabled",
      hooks: [
        {
          pluginId: "test-capture-reason",
          hookName: "before_reset",
          handler: (event) => {
            capturedReasons.push(
              (event as unknown as Record<string, unknown>).reason as string | undefined,
            );
          },
        },
      ],
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
    });

    const session = sdk.createSession({
      identity: {
        mode: "general",
        sessionId: "reset-default-test",
        sessionKey: "test:reset-default",
      },
      systemPrompt: "You are helpful.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    // Reset without specifying a reason
    await session.reset();

    expect(capturedReasons).toEqual(["manual"]);

    await sdk.shutdown();
  });
});
