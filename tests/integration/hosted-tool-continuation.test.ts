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
import type {
  AssistantMessage,
  AssistantMessageEvent,
} from "../../src/providers/anthropic-types.js";
import type { GeneralAgentStreamEvent } from "../../src/public/events.js";
import type { GeneralAgentStoredSession } from "../../src/public/persistence.js";

const mockAgentLoop = vi.fn();
const mockAgentLoopContinue = vi.fn();

vi.mock("../../src/loop/agent-loop.js", () => ({
  agentLoop: (...args: unknown[]) => mockAgentLoop(...args),
  agentLoopContinue: (...args: unknown[]) => mockAgentLoopContinue(...args),
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

function createTextDeltaEvent(delta: string): AssistantMessageEvent {
  return {
    type: "text_delta",
    contentIndex: 0,
    delta,
    partial: createAssistantMessage(delta),
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

async function* twoStepHostedToolLoop(
  _messages: AgentMessage[],
  context: AgentContext,
): AsyncIterable<AgentEvent> {
  const finishTool = context.tools?.find(
    (tool): tool is AgentTool => tool.name === "finish",
  );

  if (!finishTool) {
    throw new Error("finish tool missing");
  }

  yield {
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "finish",
    args: { step: 1 },
  };
  const result1 = await finishTool.execute("call-1", { step: 1 });
  yield {
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "finish",
    result: result1,
    isError: false,
  };
  yield {
    type: "message_update",
    message: createAssistantMessage("after first tool"),
    assistantMessageEvent: createTextDeltaEvent("after first tool"),
  };

  yield {
    type: "tool_execution_start",
    toolCallId: "call-2",
    toolName: "finish",
    args: { step: 2 },
  };
  const result2 = await finishTool.execute("call-2", { step: 2 });
  yield {
    type: "tool_execution_end",
    toolCallId: "call-2",
    toolName: "finish",
    result: result2,
    isError: false,
  };

  const finalMessage = createAssistantMessage("all done");
  yield {
    type: "message_update",
    message: finalMessage,
    assistantMessageEvent: createTextDeltaEvent("all done"),
  };
  yield {
    type: "turn_end",
    message: finalMessage,
    toolResults: [],
  };
}

async function* errorRecoveringHostedToolLoop(
  _messages: AgentMessage[],
  context: AgentContext,
): AsyncIterable<AgentEvent> {
  const finishTool = context.tools?.find(
    (tool): tool is AgentTool => tool.name === "finish",
  );

  if (!finishTool) {
    throw new Error("finish tool missing");
  }

  yield {
    type: "tool_execution_start",
    toolCallId: "call-err-1",
    toolName: "finish",
    args: { step: 1 },
  };
  const result = await finishTool.execute("call-err-1", { step: 1 });
  yield {
    type: "tool_execution_end",
    toolCallId: "call-err-1",
    toolName: "finish",
    result,
    isError: false,
  };

  const finalMessage = createAssistantMessage("recovered after error");
  yield {
    type: "message_update",
    message: finalMessage,
    assistantMessageEvent: createTextDeltaEvent("recovered after error"),
  };
  yield {
    type: "turn_end",
    message: finalMessage,
    toolResults: [],
  };
}

async function* delegateHostedToolLoop(
  _messages: AgentMessage[],
  context: AgentContext,
): AsyncIterable<AgentEvent> {
  const delegateTool = context.tools?.find(
    (tool): tool is AgentTool => tool.name === "delegate",
  );

  if (!delegateTool) {
    throw new Error("delegate tool missing");
  }

  yield {
    type: "tool_execution_start",
    toolCallId: "call-sub-1",
    toolName: "delegate",
    args: { task: "research" },
  };
  const result = await delegateTool.execute("call-sub-1", { task: "research" });
  yield {
    type: "tool_execution_end",
    toolCallId: "call-sub-1",
    toolName: "delegate",
    result,
    isError: false,
  };

  const finalMessage = createAssistantMessage("delegate done");
  yield {
    type: "message_update",
    message: finalMessage,
    assistantMessageEvent: createTextDeltaEvent("delegate done"),
  };
  yield {
    type: "turn_end",
    message: finalMessage,
    toolResults: [],
  };
}

async function* singleToolSuspendForRestartLoop(
  _messages: AgentMessage[],
  context: AgentContext,
): AsyncIterable<AgentEvent> {
  const assistantMessage: AssistantMessage = {
    ...createAssistantMessage(""),
    content: [
      { type: "text", text: "using finish" },
      {
        type: "toolCall",
        id: "call-restart-1",
        name: "finish",
        arguments: { step: 1 },
      },
    ],
  };
  context.messages.push(assistantMessage);

  yield {
    type: "tool_execution_start",
    toolCallId: "call-restart-1",
    toolName: "finish",
    args: { step: 1 },
  };
}

async function* continueAfterRestartLoop(
  context: AgentContext,
): AsyncIterable<AgentEvent> {
  expect((context.messages.at(-1) as { role?: string } | undefined)?.role).toBe("toolResult");

  const finalMessage = createAssistantMessage("finished after restart");
  context.messages.push(finalMessage);

  yield {
    type: "message_update",
    message: finalMessage,
    assistantMessageEvent: createTextDeltaEvent("finished after restart"),
  };
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
    messages: [finalMessage],
  };
}

async function* multiToolSuspendForRestartLoop(
  _messages: AgentMessage[],
  context: AgentContext,
): AsyncIterable<AgentEvent> {
  const assistantMessage: AssistantMessage = {
    ...createAssistantMessage(""),
    content: [
      {
        type: "toolCall",
        id: "call-multi-1",
        name: "finish",
        arguments: { step: 1 },
      },
      {
        type: "toolCall",
        id: "call-multi-2",
        name: "finish",
        arguments: { step: 2 },
      },
    ],
  };
  context.messages.push(assistantMessage);

  yield {
    type: "tool_execution_start",
    toolCallId: "call-multi-1",
    toolName: "finish",
    args: { step: 1 },
  };
}

describe("hosted tool continuation", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.clearAllMocks();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resumes the same vendored run across multiple hosted tool calls until completion", async () => {
    mockAgentLoop.mockImplementation(twoStepHostedToolLoop);

    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "general-agent-sdk-continuation-"),
    );
    tempDirs.push(root);
    const sessionFile = path.join(root, "continuation.jsonl");

    const sdk = await createGeneralAgentSdk({
      workspaceDir: root,
      stateDir: path.join(root, "state"),
      agentDir: path.join(root, "agent"),
      profileId: "default",
      pluginMode: "disabled",
      anthropicApiKey: "test-api-key",
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
        sessionKey: "host:default:continuation",
      },
      systemPrompt: "Use finish twice, then answer.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    const firstStream = await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "finish the task" }],
      }),
    );

    expect(firstStream).toEqual([
      {
        kind: "tool_call",
        callId: "call-1",
        toolName: "finish",
        input: { step: 1 },
      },
      {
        kind: "hosted_tool_call",
        callId: "call-1",
        toolName: "finish",
        input: { step: 1 },
      },
    ]);
    expect(mockAgentLoop.mock.calls[0]?.[2]?.toolExecution).toBe("sequential");

    const secondStream = await collect(
      session.submitHostedToolResult({
        callId: "call-1",
        output: { ok: true, step: 1 },
        details: { ok: true, step: 1, source: "host" },
      }),
    );

    expect(secondStream).toEqual([
      {
        kind: "tool_result",
        callId: "call-1",
        toolName: "finish",
        output: [{ type: "text", text: JSON.stringify({ ok: true, step: 1 }) }],
        details: { ok: true, step: 1, source: "host" },
      },
      {
        kind: "assistant_delta",
        text: "after first tool",
      },
      {
        kind: "tool_call",
        callId: "call-2",
        toolName: "finish",
        input: { step: 2 },
      },
      {
        kind: "hosted_tool_call",
        callId: "call-2",
        toolName: "finish",
        input: { step: 2 },
      },
    ]);

    const thirdStream = await collect(
      session.submitHostedToolResult({
        callId: "call-2",
        output: { ok: true, step: 2 },
        details: { ok: true, step: 2, source: "host" },
      }),
    );

    expect(thirdStream).toEqual([
      {
        kind: "tool_result",
        callId: "call-2",
        toolName: "finish",
        output: [{ type: "text", text: JSON.stringify({ ok: true, step: 2 }) }],
        details: { ok: true, step: 2, source: "host" },
      },
      {
        kind: "assistant_delta",
        text: "all done",
      },
      {
        kind: "turn_complete",
        stopReason: "stop",
      },
    ]);

    await sdk.shutdown();
  });

  it("allows a hosted tool named delegate and resumes it with the same callId", async () => {
    mockAgentLoop.mockImplementation(delegateHostedToolLoop);

    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "general-agent-sdk-delegate-hosted-"),
    );
    tempDirs.push(root);
    const sessionFile = path.join(root, "delegate.jsonl");

    const sdk = await createGeneralAgentSdk({
      workspaceDir: root,
      stateDir: path.join(root, "state"),
      agentDir: path.join(root, "agent"),
      profileId: "default",
      pluginMode: "disabled",
      anthropicApiKey: "test-api-key",
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
          name: "delegate",
          description: "delegate to an external agent",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });

    const session = sdk.createSession({
      identity: {
        mode: "general",
        sessionId: "sess-delegate",
        sessionKey: "host:default:delegate",
      },
      systemPrompt: "Delegate using delegate tool.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    const firstStream = await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "delegate this" }],
      }),
    );

    expect(firstStream).toEqual([
      {
        kind: "tool_call",
        callId: "call-sub-1",
        toolName: "delegate",
        input: { task: "research" },
      },
      {
        kind: "hosted_tool_call",
        callId: "call-sub-1",
        toolName: "delegate",
        input: { task: "research" },
      },
    ]);

    const resumed = await collect(
      session.submitHostedToolResult({
        callId: "call-sub-1",
        output: { ok: true, agentId: "child-1" },
        details: { ok: true, agentId: "child-1", source: "host" },
      }),
    );

    expect(resumed).toEqual([
      {
        kind: "tool_result",
        callId: "call-sub-1",
        toolName: "delegate",
        output: [{ type: "text", text: JSON.stringify({ ok: true, agentId: "child-1" }) }],
        details: { ok: true, agentId: "child-1", source: "host" },
      },
      {
        kind: "assistant_delta",
        text: "delegate done",
      },
      {
        kind: "turn_complete",
        stopReason: "stop",
      },
    ]);

    await sdk.shutdown();
  });

  it("continues the same vendored run after a hosted tool error", async () => {
    mockAgentLoop.mockImplementation(errorRecoveringHostedToolLoop);

    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "general-agent-sdk-continuation-error-"),
    );
    tempDirs.push(root);
    const sessionFile = path.join(root, "continuation-error.jsonl");

    const sdk = await createGeneralAgentSdk({
      workspaceDir: root,
      stateDir: path.join(root, "state"),
      agentDir: path.join(root, "agent"),
      profileId: "default",
      pluginMode: "disabled",
      anthropicApiKey: "test-api-key",
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
        sessionId: "sess-general-error",
        sessionKey: "host:default:continuation-error",
      },
      systemPrompt: "Recover after tool errors.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    const firstStream = await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "finish the task" }],
      }),
    );

    expect(firstStream).toEqual([
      {
        kind: "tool_call",
        callId: "call-err-1",
        toolName: "finish",
        input: { step: 1 },
      },
      {
        kind: "hosted_tool_call",
        callId: "call-err-1",
        toolName: "finish",
        input: { step: 1 },
      },
    ]);

    const resumed = await collect(
      session.submitHostedToolError({
        callId: "call-err-1",
        error: "boom",
        details: { code: "EHOST", source: "host" },
      }),
    );

    expect(resumed).toEqual([
      {
        kind: "tool_error",
        callId: "call-err-1",
        toolName: "finish",
        error: "boom",
        details: { code: "EHOST", source: "host" },
      },
      {
        kind: "assistant_delta",
        text: "recovered after error",
      },
      {
        kind: "turn_complete",
        stopReason: "stop",
      },
    ]);

    await sdk.shutdown();
  });

  it("recovers a single pending hosted tool after SDK recreation", async () => {
    mockAgentLoop.mockImplementation(singleToolSuspendForRestartLoop);
    mockAgentLoopContinue.mockImplementation(continueAfterRestartLoop);

    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "general-agent-sdk-continuation-restart-"),
    );
    tempDirs.push(root);
    const sessionFile = path.join(root, "continuation-restart.jsonl");
    let storedSession: GeneralAgentStoredSession | null = null;

    const sessionStore = {
      async load() {
        return storedSession ? structuredClone(storedSession) : null;
      },
      async save(
        _identity: unknown,
        value: GeneralAgentStoredSession,
      ) {
        storedSession = structuredClone(value);
      },
      async resolveSessionFile() {
        return sessionFile;
      },
    };

    const firstSdk = await createGeneralAgentSdk({
      workspaceDir: root,
      stateDir: path.join(root, "state"),
      agentDir: path.join(root, "agent"),
      profileId: "default",
      pluginMode: "disabled",
      anthropicApiKey: "test-api-key",
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

    const firstSession = firstSdk.createSession({
      identity: {
        mode: "general",
        sessionId: "sess-restart",
        sessionKey: "host:default:restart",
      },
      systemPrompt: "Resume after restart.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    const suspended = await collect(
      firstSession.streamTurn({
        role: "user",
        content: [{ type: "text", text: "finish the task" }],
      }),
    );

    expect(suspended).toEqual([
      {
        kind: "tool_call",
        callId: "call-restart-1",
        toolName: "finish",
        input: { step: 1 },
      },
      {
        kind: "hosted_tool_call",
        callId: "call-restart-1",
        toolName: "finish",
        input: { step: 1 },
      },
    ]);
    expect(storedSession?.pendingContinuation).toMatchObject({
      strategy: "agent_loop_continue_single_tool",
      runId: expect.any(String),
      resolvedModelRef: "openai/gpt-5.4",
    });

    await firstSdk.shutdown();

    const restartedSdk = await createGeneralAgentSdk({
      workspaceDir: root,
      stateDir: path.join(root, "state"),
      agentDir: path.join(root, "agent"),
      profileId: "default",
      pluginMode: "disabled",
      anthropicApiKey: "test-api-key",
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

    const resumedSession = await restartedSdk.resumeSession("sess-restart");
    const resumedEvents = await collect(
      resumedSession.submitHostedToolResult({
        callId: "call-restart-1",
        output: { ok: true, step: 1 },
        details: { ok: true, step: 1, source: "host" },
      }),
    );

    expect(resumedEvents).toEqual([
      {
        kind: "tool_result",
        callId: "call-restart-1",
        toolName: "finish",
        output: [{ type: "text", text: JSON.stringify({ ok: true, step: 1 }) }],
        details: { ok: true, step: 1, source: "host" },
      },
      {
        kind: "assistant_delta",
        text: "finished after restart",
      },
      {
        kind: "usage_snapshot",
        snapshot: expect.objectContaining({
          usedInputTokens: 1,
          contextWindow: 200_000,
        }),
      },
      {
        kind: "turn_complete",
        stopReason: "stop",
      },
    ]);
    expect(mockAgentLoopContinue).toHaveBeenCalledTimes(1);

    await restartedSdk.shutdown();
  });

  it("recovers a multi-tool pending hosted tool after SDK recreation", async () => {
    mockAgentLoop.mockImplementation(multiToolSuspendForRestartLoop);
    mockAgentLoopContinue.mockImplementation(continueAfterRestartLoop);

    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "general-agent-sdk-continuation-multi-tool-"),
    );
    tempDirs.push(root);
    const sessionFile = path.join(root, "continuation-multi-tool.jsonl");
    let storedSession: GeneralAgentStoredSession | null = null;

    const sessionStore = {
      async load() {
        return storedSession ? structuredClone(storedSession) : null;
      },
      async save(
        _identity: unknown,
        value: GeneralAgentStoredSession,
      ) {
        storedSession = structuredClone(value);
      },
      async resolveSessionFile() {
        return sessionFile;
      },
    };

    const firstSdk = await createGeneralAgentSdk({
      workspaceDir: root,
      stateDir: path.join(root, "state"),
      agentDir: path.join(root, "agent"),
      profileId: "default",
      pluginMode: "disabled",
      anthropicApiKey: "test-api-key",
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

    const firstSession = firstSdk.createSession({
      identity: {
        mode: "general",
        sessionId: "sess-multi-tool",
        sessionKey: "host:default:multi-tool",
      },
      systemPrompt: "Multi-tool restart recovery.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    const suspended = await collect(
      firstSession.streamTurn({
        role: "user",
        content: [{ type: "text", text: "finish the task" }],
      }),
    );

    expect(suspended).toEqual([
      {
        kind: "tool_call",
        callId: "call-multi-1",
        toolName: "finish",
        input: { step: 1 },
      },
      {
        kind: "hosted_tool_call",
        callId: "call-multi-1",
        toolName: "finish",
        input: { step: 1 },
      },
    ]);
    expect(storedSession?.pendingContinuation).toMatchObject({
      strategy: "agent_loop_continue_multi_tool",
      runId: expect.any(String),
      resolvedModelRef: "openai/gpt-5.4",
    });

    await firstSdk.shutdown();

    const restartedSdk = await createGeneralAgentSdk({
      workspaceDir: root,
      stateDir: path.join(root, "state"),
      agentDir: path.join(root, "agent"),
      profileId: "default",
      pluginMode: "disabled",
      anthropicApiKey: "test-api-key",
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

    const resumedSession = await restartedSdk.resumeSession("sess-multi-tool");
    const resumedEvents = await collect(
      resumedSession.submitHostedToolResult({
        callId: "call-multi-1",
        output: { ok: true, step: 1 },
        details: { ok: true, step: 1, source: "host" },
      }),
    );

    expect(resumedEvents).toEqual([
      {
        kind: "tool_result",
        callId: "call-multi-1",
        toolName: "finish",
        output: [{ type: "text", text: JSON.stringify({ ok: true, step: 1 }) }],
        details: { ok: true, step: 1, source: "host" },
      },
      {
        kind: "assistant_delta",
        text: "finished after restart",
      },
      {
        kind: "usage_snapshot",
        snapshot: expect.objectContaining({
          usedInputTokens: 1,
          contextWindow: 200_000,
        }),
      },
      {
        kind: "turn_complete",
        stopReason: "stop",
      },
    ]);
    expect(mockAgentLoopContinue).toHaveBeenCalled();

    await restartedSdk.shutdown();
  });
});
