import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GeneralAgentHookRegistration,
  GeneralAgentStreamEvent,
} from "../../src/index.js";

const mockAgentLoop = vi.fn();

vi.mock("../../src/loop/agent-loop.js", () => ({
  agentLoop: (...args: unknown[]) => mockAgentLoop(...args),
}));

async function collect(
  stream: AsyncIterable<GeneralAgentStreamEvent>,
): Promise<GeneralAgentStreamEvent[]> {
  const events: GeneralAgentStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe("compaction", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.clearAllMocks();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requestCompaction and maybeCompactByTokens are callable without error", async () => {
    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-compact-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "compact-test.jsonl");

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
    });

    const session = sdk.createSession({
      identity: {
        mode: "general",
        sessionId: "compact-test",
        sessionKey: "test:compact",
      },
      systemPrompt: "You are helpful.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    // Both methods should be callable without throwing
    await session.requestCompaction();
    await session.maybeCompactByTokens({ usedPctThreshold: 85, cooldownMs: 0 });

    await sdk.shutdown();
  });

  it("compaction fires before_compaction and after_compaction hooks when there are messages", async () => {
    const hookCalls: string[] = [];

    // Mock the agent loop to produce a turn with an assistant message,
    // which populates agentMessages so compaction has something to work on
    mockAgentLoop.mockImplementation(
      async function* (
        _messages: unknown[],
        context: { messages: unknown[] },
      ) {
        const assistantMessage = {
          role: "assistant" as const,
          content: [{ type: "text" as const, text: "I can help with that." }],
          api: "anthropic-messages" as const,
          provider: "anthropic",
          model: "openai/gpt-5.4",
          usage: {
            input: 100,
            output: 50,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 150,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop" as const,
          timestamp: Date.now(),
        };
        context.messages.push(
          { role: "user", content: "hello", timestamp: Date.now() },
          assistantMessage,
        );
        yield { type: "message_end", message: assistantMessage };
        yield {
          type: "turn_end",
          message: assistantMessage,
          toolResults: [],
        };
      },
    );

    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-compact-hooks-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "compact-hooks-test.jsonl");

    const hooks: GeneralAgentHookRegistration[] = [
      {
        pluginId: "test-before-compaction",
        hookName: "before_compaction",
        handler: () => {
          hookCalls.push("before_compaction");
        },
      },
      {
        pluginId: "test-after-compaction",
        hookName: "after_compaction",
        handler: () => {
          hookCalls.push("after_compaction");
        },
      },
    ];

    const sdk = await createGeneralAgentSdk({
      workspaceDir: root,
      stateDir: path.join(root, "state"),
      agentDir: path.join(root, "agent"),
      profileId: "default",
      pluginMode: "disabled",
      anthropicApiKey: "test-api-key",
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
    });

    const session = sdk.createSession({
      identity: {
        mode: "general",
        sessionId: "compact-hook-test",
        sessionKey: "test:compact-hook",
      },
      systemPrompt: "You are helpful.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    // Run a turn to populate agentMessages
    await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "hello" }],
      }),
    );

    // Now requestCompaction should have messages to compact and fire the hooks
    await session.requestCompaction();

    expect(hookCalls).toContain("before_compaction");
    expect(hookCalls).toContain("after_compaction");

    await sdk.shutdown();
  });

  it("requestCompaction is a no-op when agentMessages is empty (no hooks fired)", async () => {
    const hookCalls: string[] = [];
    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-compact-noop-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "compact-noop-test.jsonl");

    const hooks: GeneralAgentHookRegistration[] = [
      {
        pluginId: "test-before-compaction",
        hookName: "before_compaction",
        handler: () => {
          hookCalls.push("before_compaction");
        },
      },
      {
        pluginId: "test-after-compaction",
        hookName: "after_compaction",
        handler: () => {
          hookCalls.push("after_compaction");
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
    });

    const session = sdk.createSession({
      identity: {
        mode: "general",
        sessionId: "compact-noop-test",
        sessionKey: "test:compact-noop",
      },
      systemPrompt: "You are helpful.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    // No turn was run, so agentMessages is empty — compaction should be a no-op
    await session.requestCompaction();

    expect(hookCalls).toEqual([]);

    await sdk.shutdown();
  });
});
