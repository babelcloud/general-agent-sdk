import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentContext,
  AgentEvent,
  AgentMessage,
  AgentTool,
} from "../../src/loop/agent-types.js";
import type { AssistantMessage } from "../../src/providers/anthropic-types.js";
import type {
  GeneralAgentHookRegistration,
  GeneralAgentStreamEvent,
} from "../../src/index.js";

const mockAgentLoop = vi.fn();

vi.mock("../../src/loop/agent-loop.js", () => ({
  agentLoop: (...args: unknown[]) => mockAgentLoop(...args),
}));

function createAssistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "openai/gpt-5.4",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

async function collect(
  stream: AsyncIterable<GeneralAgentStreamEvent>,
): Promise<GeneralAgentStreamEvent[]> {
  const events: GeneralAgentStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

async function* singleHostedToolLoop(
  _messages: unknown[],
  context: AgentContext,
  config: {
    beforeToolCall?: (...args: any[]) => Promise<any>;
    afterToolCall?: (...args: any[]) => Promise<any>;
  },
): AsyncIterable<AgentEvent> {
  const finishTool = context.tools?.find(
    (tool): tool is AgentTool => tool.name === "finish",
  );

  if (!finishTool) {
    throw new Error("finish tool missing");
  }

  const assistantMessage = createAssistantMessage("");
  const toolCall = {
    type: "toolCall" as const,
    id: "call-1",
    name: "finish",
    arguments: { step: 1 },
  };

  const beforeResult = await config.beforeToolCall?.({
    assistantMessage,
    toolCall,
    args: toolCall.arguments,
    context,
  });

  if (beforeResult?.block) {
    yield {
      type: "turn_end",
      message: createAssistantMessage("blocked"),
      toolResults: [],
    };
    return;
  }

  const args = beforeResult?.args ?? toolCall.arguments;

  yield {
    type: "tool_execution_start",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    args,
  };

  const result = await finishTool.execute(toolCall.id, args);

  await config.afterToolCall?.({
    assistantMessage,
    toolCall: {
      ...toolCall,
      arguments: args,
    },
    args,
    result,
    isError: false,
    context,
  });

  yield {
    type: "tool_execution_end",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    result,
    isError: false,
  };

  yield {
    type: "turn_end",
    message: createAssistantMessage("done"),
    toolResults: [],
  };
}

async function* singleAssistantTurnLoop(
  _messages: AgentMessage[],
  _context: AgentContext,
): AsyncIterable<AgentEvent> {
  const finalMessage = createAssistantMessage("done");
  yield {
    type: "turn_end",
    message: finalMessage,
    toolResults: [],
  };
}

async function* assistantLifecycleLoop(
  messages: AgentMessage[],
  _context: AgentContext,
): AsyncIterable<AgentEvent> {
  const finalMessage = createAssistantMessage("done");
  yield {
    type: "message_end",
    message: finalMessage,
  };
  yield {
    type: "turn_end",
    message: finalMessage,
    toolResults: [],
  };
  yield {
    type: "agent_end",
    messages: [...messages, finalMessage],
  };
}

describe("SDK hooks", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.clearAllMocks();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies before_tool_call param rewrites and runs after_tool_call observers", async () => {
    mockAgentLoop.mockImplementation(singleHostedToolLoop);
    const afterEvents: Array<Record<string, unknown>> = [];
    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-hooks-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "hooks.jsonl");

    const hooks: GeneralAgentHookRegistration[] = [
      {
        pluginId: "rewrite-finish-step",
        hookName: "before_tool_call",
        handler: () => ({
          params: { step: 2 },
        }),
      },
      {
        pluginId: "observe-after-tool",
        hookName: "after_tool_call",
        handler: (event) => {
          afterEvents.push(event as unknown as Record<string, unknown>);
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
        sessionId: "sess-hooks",
        sessionKey: "host:default:hooks",
      },
      systemPrompt: "Use finish immediately.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    const firstTurn = await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "finish now" }],
      }),
    );

    expect(firstTurn).toContainEqual({
      kind: "hosted_tool_call",
      callId: "call-1",
      toolName: "finish",
      input: { step: 2 },
    });

    await collect(
      session.submitHostedToolResult({
        callId: "call-1",
        output: { ok: true },
        details: { source: "host" },
      }),
    );

    expect(afterEvents).toHaveLength(1);
    expect(afterEvents[0]).toMatchObject({
      toolName: "finish",
      params: { step: 2 },
      result: { source: "host" },
    });

    await sdk.shutdown();
  });

  it("applies before_model_resolve and before_prompt_build hooks before invoking the agent loop", async () => {
    let capturedModelId = "";
    let capturedSystemPrompt = "";
    let capturedUserContent: unknown;
    mockAgentLoop.mockImplementation(async function* (
      messages: AgentMessage[],
      context: AgentContext,
      config: { model: { id: string } },
    ): AsyncIterable<AgentEvent> {
      capturedModelId = config.model.id;
      capturedSystemPrompt = context.systemPrompt;
      capturedUserContent = (messages[0] as { content: unknown }).content;
      yield* singleAssistantTurnLoop(messages, context);
    });
    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-hooks-model-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "hooks-model.jsonl");

    const sdk = await createGeneralAgentSdk({
      workspaceDir: root,
      stateDir: path.join(root, "state"),
      agentDir: path.join(root, "agent"),
      profileId: "default",
      pluginMode: "disabled",
      anthropicApiKey: "test-api-key",
      hooks: [
        {
          pluginId: "legacy-before-agent-start",
          hookName: "before_agent_start",
          handler: () => ({
            providerOverride: "anthropic",
            modelOverride: "legacy-model",
            systemPrompt: "legacy-system",
            prependContext: "legacy-user",
            prependSystemContext: "legacy-prefix",
            appendSystemContext: "legacy-suffix",
          }),
        },
        {
          pluginId: "before-model-resolve",
          hookName: "before_model_resolve",
          handler: () => ({
            providerOverride: "openai",
            modelOverride: "gpt-5.4",
          }),
        },
        {
          pluginId: "before-prompt-build",
          hookName: "before_prompt_build",
          handler: () => ({
            systemPrompt: "new-system",
            prependContext: "new-user",
            prependSystemContext: "new-prefix",
            appendSystemContext: "new-suffix",
          }),
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
        sessionId: "sess-hooks-model",
        sessionKey: "host:default:hooks-model",
      },
      systemPrompt: "base-system",
      modelRef: "anthropic/claude-3-7-sonnet",
      sessionFile,
    });

    await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "hello world" }],
      }),
    );

    expect(capturedModelId).toBe("openai/gpt-5.4");
    expect(capturedSystemPrompt).toBe(
      "new-prefix\n\nlegacy-prefix\n\nnew-system\n\nnew-suffix\n\nlegacy-suffix",
    );
    expect(capturedUserContent).toBe("new-user\n\nlegacy-user\n\nhello world");

    await sdk.shutdown();
  });

  it("applies tool_result_persist and before_message_write hooks before transcript append", async () => {
    mockAgentLoop.mockImplementation(singleHostedToolLoop);
    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-hooks-write-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "hooks-write.jsonl");

    const hooks: GeneralAgentHookRegistration[] = [
      {
        pluginId: "redact-tool-result",
        hookName: "tool_result_persist",
        handler: (event) => ({
          message: {
            ...(event.message as Record<string, unknown>),
            details: { redacted: true },
          } as any,
        }),
      },
      {
        pluginId: "block-empty-assistant",
        hookName: "before_message_write",
        handler: (event) => {
          const message = event.message as Record<string, unknown>;
          if (message.role === "toolResult" && (message.toolName as string) === "finish") {
            return {
              message: {
                ...message,
                details: { persisted: true },
              } as any,
            };
          }
          return;
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
        sessionId: "sess-hooks-write",
        sessionKey: "host:default:hooks-write",
      },
      systemPrompt: "Use finish immediately.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "finish now" }],
      }),
    );

    await collect(
      session.submitHostedToolResult({
        callId: "call-1",
        output: { ok: true },
        details: { original: true },
      }),
    );

    const transcript = fs
      .readFileSync(sessionFile, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(transcript).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        toolName: "finish",
        details: { persisted: true },
      }),
    );

    await sdk.shutdown();
  });

  it("applies before_tool_call rewrites in hosted-tool fallback mode without an API key", async () => {
    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-hooks-fallback-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "hooks-fallback.jsonl");

    const sdk = await createGeneralAgentSdk({
      workspaceDir: root,
      stateDir: path.join(root, "state"),
      agentDir: path.join(root, "agent"),
      profileId: "default",
      pluginMode: "disabled",
      hooks: [
        {
          pluginId: "rewrite-fallback-finish-step",
          hookName: "before_tool_call",
          handler: () => ({
            params: { step: 7 },
          }),
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
        sessionId: "sess-hooks-fallback",
        sessionKey: "host:default:hooks-fallback",
      },
      systemPrompt: "Use finish immediately.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    const events = await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "finish now" }],
      }),
    );

    expect(events).toContainEqual({
      kind: "hosted_tool_call",
      callId: expect.any(String),
      toolName: "finish",
      input: { step: 7 },
    });

    await sdk.shutdown();
  });

  it("dispatches host-emitted hook families through sdk.emitHook with upstream merge semantics", async () => {
    const messageSendingThird = vi.fn(() => ({
      content: "third",
    }));
    const inboundClaimFirst = vi.fn(() => ({
      handled: false,
    }));
    const inboundClaimSecond = vi.fn(() => ({
      handled: true,
    }));
    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-hooks-emit-"));
    tempDirs.push(root);

    const sdk = await createGeneralAgentSdk({
      workspaceDir: root,
      stateDir: path.join(root, "state"),
      agentDir: path.join(root, "agent"),
      profileId: "default",
      pluginMode: "disabled",
      hooks: [
        {
          pluginId: "message-sending-first",
          hookName: "message_sending",
          handler: () => ({
            content: "first",
          }),
        },
        {
          pluginId: "message-sending-second",
          hookName: "message_sending",
          handler: () => ({
            content: "second",
            cancel: true,
          }),
        },
        {
          pluginId: "message-sending-third",
          hookName: "message_sending",
          handler: messageSendingThird,
        },
        {
          pluginId: "inbound-claim-first",
          hookName: "inbound_claim",
          handler: inboundClaimFirst,
        },
        {
          pluginId: "inbound-claim-second",
          hookName: "inbound_claim",
          handler: inboundClaimSecond,
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
          return path.join(root, "session.jsonl");
        },
      },
    });

    const messageSendingResult = await sdk.emitHook({
      hookName: "message_sending",
      event: {
        to: "channel:123",
        content: "hello",
      },
      context: {
        channelId: "discord",
      },
    });

    expect(messageSendingResult).toEqual({
      content: "second",
      cancel: true,
    });
    expect(messageSendingThird).not.toHaveBeenCalled();

    const inboundClaimResult = await sdk.emitHook({
      hookName: "inbound_claim",
      event: {
        content: "hello",
        channel: "discord",
        isGroup: false,
      },
      context: {
        channelId: "discord",
      },
    });

    expect(inboundClaimResult).toEqual({
      handled: true,
    });
    expect(inboundClaimFirst).toHaveBeenCalledTimes(1);
    expect(inboundClaimSecond).toHaveBeenCalledTimes(1);

    await sdk.shutdown();
  });

  it("fires session_start on first turn and session_end on sdk shutdown", async () => {
    mockAgentLoop.mockImplementation(singleAssistantTurnLoop);
    const sessionStart = vi.fn();
    const sessionEnd = vi.fn();
    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-hooks-session-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "hooks-session.jsonl");

    const sdk = await createGeneralAgentSdk({
      workspaceDir: root,
      stateDir: path.join(root, "state"),
      agentDir: path.join(root, "agent"),
      profileId: "default",
      pluginMode: "disabled",
      anthropicApiKey: "test-api-key",
      hooks: [
        {
          pluginId: "session-start",
          hookName: "session_start",
          handler: sessionStart,
        },
        {
          pluginId: "session-end",
          hookName: "session_end",
          handler: sessionEnd,
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
        sessionId: "sess-hooks-session",
        sessionKey: "host:default:hooks-session",
      },
      systemPrompt: "Be concise.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "hello" }],
      }),
    );

    expect(sessionStart).toHaveBeenCalledWith(
      {
        sessionId: "sess-hooks-session",
        sessionKey: "host:default:hooks-session",
        resumedFrom: undefined,
      },
      {
        agentId: undefined,
        sessionId: "sess-hooks-session",
        sessionKey: "host:default:hooks-session",
      },
    );

    await sdk.shutdown();

    expect(sessionEnd).toHaveBeenCalledTimes(1);
    expect(sessionEnd.mock.calls[0]?.[0]).toMatchObject({
      sessionId: "sess-hooks-session",
      sessionKey: "host:default:hooks-session",
      messageCount: expect.any(Number),
    });
  });

  it("auto-fires llm_input, agent_end, and llm_output during runtime execution", async () => {
    mockAgentLoop.mockImplementation(assistantLifecycleLoop);
    const calls: Array<{ hookName: string; event: Record<string, unknown> }> = [];
    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-hooks-llm-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "hooks-llm.jsonl");

    const sdk = await createGeneralAgentSdk({
      workspaceDir: root,
      stateDir: path.join(root, "state"),
      agentDir: path.join(root, "agent"),
      profileId: "default",
      pluginMode: "disabled",
      anthropicApiKey: "test-api-key",
      hooks: [
        {
          pluginId: "llm-input",
          hookName: "llm_input",
          handler: (event) => {
            calls.push({ hookName: "llm_input", event: event as Record<string, unknown> });
          },
        },
        {
          pluginId: "agent-end",
          hookName: "agent_end",
          handler: (event) => {
            calls.push({ hookName: "agent_end", event: event as Record<string, unknown> });
          },
        },
        {
          pluginId: "llm-output",
          hookName: "llm_output",
          handler: (event) => {
            calls.push({ hookName: "llm_output", event: event as Record<string, unknown> });
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
        sessionId: "sess-hooks-llm",
        sessionKey: "host:default:hooks-llm",
      },
      systemPrompt: "Be precise.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    await collect(
      session.streamTurn({
        role: "user",
        content: [
          { type: "text", text: "hello hooks" },
          { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
        ],
      }),
    );

    expect(calls.map((entry) => entry.hookName)).toEqual([
      "llm_input",
      "agent_end",
      "llm_output",
    ]);

    expect(calls[0]?.event).toMatchObject({
      sessionId: "sess-hooks-llm",
      provider: "openai",
      model: "gpt-5.4",
      prompt: "hello hooks",
      imagesCount: 1,
      systemPrompt: "Be precise.",
    });
    expect(calls[1]?.event).toMatchObject({
      success: true,
      messages: expect.any(Array),
      durationMs: expect.any(Number),
    });
    expect(calls[2]?.event).toMatchObject({
      sessionId: "sess-hooks-llm",
      provider: "openai",
      model: "gpt-5.4",
      assistantTexts: ["done"],
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        total: 2,
      },
    });

    await sdk.shutdown();
  });

  it("fires before_reset and clears transcript state for the session", async () => {
    const beforeReset = vi.fn();
    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-hooks-reset-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "hooks-reset.jsonl");

    const sdk = await createGeneralAgentSdk({
      workspaceDir: root,
      stateDir: path.join(root, "state"),
      agentDir: path.join(root, "agent"),
      profileId: "default",
      pluginMode: "disabled",
      hooks: [
        {
          pluginId: "before-reset",
          hookName: "before_reset",
          handler: beforeReset,
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
        sessionId: "sess-hooks-reset",
        sessionKey: "host:default:hooks-reset",
      },
      systemPrompt: "Stay concise.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "first finish turn" }],
      }),
    );

    expect(fs.readFileSync(sessionFile, "utf8")).toContain("first finish turn");
    expect(session.getUsageSnapshot()).not.toBeNull();

    await session.reset("manual-reset");

    expect(beforeReset).toHaveBeenCalledWith(
      {
        sessionFile,
        messages: [],
        reason: "manual-reset",
      },
      {
        agentId: undefined,
        sessionKey: "host:default:hooks-reset",
        sessionId: "sess-hooks-reset",
        workspaceDir: root,
      },
    );
    expect(fs.readFileSync(sessionFile, "utf8")).toBe("");
    expect(session.getUsageSnapshot()).toBeNull();

    await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "second finish turn" }],
      }),
    );

    const transcriptAfterReset = fs.readFileSync(sessionFile, "utf8");
    expect(transcriptAfterReset).toContain("second finish turn");
    expect(transcriptAfterReset).not.toContain("first finish turn");

    await sdk.shutdown();
  });
});
