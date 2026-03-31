import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentContext,
  AgentEvent,
  AgentTool,
} from "../../src/loop/agent-types.js";
import type { AssistantMessage } from "../../src/providers/anthropic-types.js";
import type {
  GeneralAgentHookRegistration,
  GeneralAgentStreamEvent,
} from "../../src/index.js";

/**
 * Mock call counter: agentLoop is called once for the parent session and
 * once for each child session. We need separate behaviors for parent vs child.
 */
let agentLoopCallCount = 0;
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

/**
 * Agent loop for the PARENT session: finds the `subagents` tool, calls it,
 * then emits the tool result and a final assistant response.
 */
async function* parentCallsSubagentLoop(
  _messages: unknown[],
  context: AgentContext,
  config: {
    beforeToolCall?: (...args: any[]) => Promise<any>;
    afterToolCall?: (...args: any[]) => Promise<any>;
  },
): AsyncIterable<AgentEvent> {
  const subagentTool = context.tools?.find(
    (tool): tool is AgentTool => tool.name === "subagents",
  );

  if (!subagentTool) {
    throw new Error("subagents tool missing from parent tool set");
  }

  const assistantMessage = createAssistantMessage("");
  const toolCall = {
    type: "toolCall" as const,
    id: "sub-call-1",
    name: "subagents",
    arguments: {
      instructions: "You are a math expert.",
      task: "What is 2+2?",
      label: "math-subagent",
    },
  };

  const beforeResult = await config.beforeToolCall?.({
    assistantMessage,
    toolCall,
    args: toolCall.arguments,
    context,
  });

  const args = beforeResult?.args ?? toolCall.arguments;

  yield {
    type: "tool_execution_start",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    args,
  };

  // This actually invokes the subagent tool, which creates a child session
  const result = await subagentTool.execute(toolCall.id, args);

  await config.afterToolCall?.({
    assistantMessage,
    toolCall: { ...toolCall, arguments: args },
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
    message: createAssistantMessage("The subagent answered: " + result.content[0]?.text),
    toolResults: [],
  };
}

/**
 * Agent loop for the CHILD session: emits message_update (→ assistant_delta)
 * then turn_end to complete.
 */
async function* childRespondsLoop(): AsyncIterable<AgentEvent> {
  const assistantMsg = createAssistantMessage("The answer is 4.");

  // Emit message_update with text_delta so the adapter produces assistant_delta events
  yield {
    type: "message_update",
    message: assistantMsg,
    assistantMessageEvent: {
      type: "text_delta",
      delta: "The answer is 4.",
    },
  };

  yield {
    type: "turn_end",
    message: assistantMsg,
    toolResults: [],
  };
}

describe("subagent runtime", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    agentLoopCallCount = 0;
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs a subagent as a core built-in tool with independent child session", async () => {
    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-subagent-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "parent.jsonl");

    // Track lifecycle hook calls
    const hookCalls: string[] = [];

    const hooks: GeneralAgentHookRegistration[] = [
      {
        hookName: "subagent_spawning",
        handler: async (event) => {
          hookCalls.push(`spawning:${event.agentId}`);
          return { status: "ok" as const };
        },
      },
      {
        hookName: "subagent_delivery_target",
        handler: async () => {
          hookCalls.push("delivery_target");
          return undefined;
        },
      },
      {
        hookName: "subagent_spawned",
        handler: async (event) => {
          hookCalls.push(`spawned:${(event as any).agentId}`);
        },
      },
      {
        hookName: "subagent_ended",
        handler: async (event) => {
          hookCalls.push(`ended:${(event as any).outcome}`);
        },
      },
    ];

    // Mock: first call is parent, second call is child
    mockAgentLoop.mockImplementation(
      (_messages: unknown[], context: AgentContext, config: any) => {
        agentLoopCallCount++;
        if (agentLoopCallCount === 1) {
          // Parent: calls the subagents tool
          return parentCallsSubagentLoop(_messages, context, config);
        }
        // Child: just responds
        return childRespondsLoop();
      },
    );

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
        async load() { return null; },
        async save() {},
        async resolveSessionFile() { return sessionFile; },
      },
      hostedTools: [
        {
          name: "finish",
          description: "finish the task",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      hooks,
      anthropicApiKey: "test-key-subagent",
    });

    const session = sdk.createSession({
      identity: {
        mode: "general",
        sessionId: "sess-parent",
        sessionKey: "host:default:parent",
      },
      systemPrompt: "You are a coordinator agent.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    const events = await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "Delegate the math question to a subagent" }],
      }),
    );

    // Verify tool_call and tool_result events were emitted for the subagent
    const toolCalls = events.filter((e) => e.kind === "tool_call");
    expect(toolCalls.length).toBe(1);
    expect(toolCalls[0]!.kind === "tool_call" && toolCalls[0]!.toolName).toBe("subagents");

    const toolResults = events.filter((e) => e.kind === "tool_result");
    expect(toolResults.length).toBe(1);

    // tool_result.output comes from the agent event adapter
    const resultEvent = toolResults[0] as Extract<GeneralAgentStreamEvent, { kind: "tool_result" }>;
    expect(resultEvent.toolName).toBe("subagents");
    // The subagent returned "The answer is 4." — verify it's present in output
    const output = resultEvent.output;
    const outputStr = JSON.stringify(output);
    expect(outputStr).toContain("4");

    // Verify turn completed
    expect(events.some((e) => e.kind === "turn_complete")).toBe(true);

    // Verify all lifecycle hooks fired in correct order
    expect(hookCalls).toEqual([
      "spawning:math-subagent",
      "delivery_target",
      "spawned:math-subagent",
      "ended:ok",
    ]);

    // Verify agentLoop was called twice (parent + child)
    expect(agentLoopCallCount).toBe(2);

    await sdk.shutdown();
  });

  it("child session does not include the subagents tool (prevents recursion)", async () => {
    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-subagent-scope-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "parent.jsonl");

    let childToolNames: string[] = [];

    mockAgentLoop.mockImplementation(
      (_messages: unknown[], context: AgentContext, config: any) => {
        agentLoopCallCount++;
        if (agentLoopCallCount === 1) {
          return parentCallsSubagentLoop(_messages, context, config);
        }
        // Child: record available tools, then respond
        childToolNames = (context.tools ?? []).map((t) => t.name);
        return childRespondsLoop();
      },
    );

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
        async load() { return null; },
        async save() {},
        async resolveSessionFile() { return sessionFile; },
      },
      anthropicApiKey: "test-key-scope",
    });

    const session = sdk.createSession({
      identity: {
        mode: "general",
        sessionId: "sess-scope",
        sessionKey: "host:default:scope",
      },
      systemPrompt: "Delegate tasks.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "run subagent" }],
      }),
    );

    // Child should NOT have 'subagents' tool
    expect(childToolNames).not.toContain("subagents");
    // But should have other core tools
    expect(childToolNames).toContain("read");
    expect(childToolNames).toContain("exec");

    await sdk.shutdown();
  });

  it("subagent_spawning hook can block subagent creation", async () => {
    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-subagent-block-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "parent.jsonl");

    const hooks: GeneralAgentHookRegistration[] = [
      {
        hookName: "subagent_spawning",
        handler: async () => {
          return { status: "error" as const, error: "Subagent creation not allowed" };
        },
      },
    ];

    mockAgentLoop.mockImplementation(
      (_messages: unknown[], context: AgentContext, config: any) => {
        agentLoopCallCount++;
        return parentCallsSubagentLoop(_messages, context, config);
      },
    );

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
        async load() { return null; },
        async save() {},
        async resolveSessionFile() { return sessionFile; },
      },
      hooks,
      anthropicApiKey: "test-key-block",
    });

    const session = sdk.createSession({
      identity: {
        mode: "general",
        sessionId: "sess-block",
        sessionKey: "host:default:block",
      },
      systemPrompt: "Delegate tasks.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    const events = await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "try to run subagent" }],
      }),
    );

    // The tool result should indicate failure (tool returns error content when hook blocks)
    const toolResults = events.filter((e) => e.kind === "tool_result");
    expect(toolResults.length).toBe(1);
    const resultEvent = toolResults[0] as Extract<GeneralAgentStreamEvent, { kind: "tool_result" }>;
    const outputContent = resultEvent.output as Array<{ type: string; text?: string }>;
    expect(outputContent.some((c) => c.type === "text" && c.text?.includes("failed"))).toBe(true);

    // Only one agentLoop call (parent only, child was blocked)
    expect(agentLoopCallCount).toBe(1);

    await sdk.shutdown();
  });
});
