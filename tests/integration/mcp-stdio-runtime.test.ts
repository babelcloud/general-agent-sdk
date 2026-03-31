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
  GeneralAgentStoredSession,
} from "../../src/public/persistence.js";
import type { GeneralAgentStreamEvent } from "../../src/public/events.js";

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

async function* singleMcpToolLoop(
  _messages: unknown[],
  context: AgentContext,
): AsyncIterable<AgentEvent> {
  const echoTool = context.tools?.find(
    (tool): tool is AgentTool => tool.name === "echo",
  );

  if (!echoTool) {
    throw new Error("echo tool missing");
  }

  yield {
    type: "tool_execution_start",
    toolCallId: "call-mcp-1",
    toolName: "echo",
    args: { text: "hello from mcp" },
  };

  const result = await echoTool.execute("call-mcp-1", { text: "hello from mcp" });

  yield {
    type: "tool_execution_end",
    toolCallId: "call-mcp-1",
    toolName: "echo",
    result,
    isError: false,
  };

  yield {
    type: "turn_end",
    message: createAssistantMessage("done"),
    toolResults: [],
  };
}

describe("MCP stdio runtime", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.clearAllMocks();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("injects stdio MCP tools into the same vendored run and executes them", async () => {
    mockAgentLoop.mockImplementation(singleMcpToolLoop);
    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-mcp-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "mcp.jsonl");

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
    });

    const session = sdk.createSession({
      identity: {
        mode: "general",
        sessionId: "sess-mcp",
        sessionKey: "host:default:mcp",
      },
      systemPrompt: "Use MCP tools when available.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    session.setDynamicMcpServers({
      echo_server: {
        transport: "stdio",
        command: process.execPath,
        args: [new URL("../fixtures/mcp/echo-server.mjs", import.meta.url).pathname],
      },
    });

    const events = await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "echo hello" }],
      }),
    );

    expect(
      mockAgentLoop.mock.calls[0]?.[1]?.tools?.some((tool: AgentTool) => tool.name === "echo"),
    ).toBe(true);

    expect(events).toContainEqual({
      kind: "tool_call",
      callId: "call-mcp-1",
      toolName: "echo",
      input: { text: "hello from mcp" },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "tool_result",
        callId: "call-mcp-1",
        toolName: "echo",
        details: expect.objectContaining({
          structuredContent: {
            echoedText: "hello from mcp",
          },
        }),
      }),
    );

    await sdk.shutdown();
  });

  it("reports MCP server status and toggles enabled state through currentQuery", async () => {
    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-mcp-status-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "mcp-status.jsonl");

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
        sessionId: "sess-mcp-status",
        sessionKey: "host:default:mcp-status",
      },
      systemPrompt: "Stay idle.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    session.setDynamicMcpServers({
      echo_server: {
        transport: "stdio",
        command: process.execPath,
        args: [new URL("../fixtures/mcp/echo-server.mjs", import.meta.url).pathname],
      },
    });

    const query = session.getCurrentQuery();
    expect(query).not.toBeNull();

    let status = await query?.mcpServerStatus?.();
    expect(status).toEqual([
      expect.objectContaining({
        serverName: "echo_server",
        enabled: true,
        transport: "stdio",
      }),
    ]);

    await query?.toggleMcpServer?.("echo_server", false);
    status = await query?.mcpServerStatus?.();
    expect(status).toEqual([
      expect.objectContaining({
        serverName: "echo_server",
        enabled: false,
      }),
    ]);

    await query?.toggleMcpServer?.("echo_server", true);
    status = await query?.mcpServerStatus?.();
    expect(status).toEqual([
      expect.objectContaining({
        serverName: "echo_server",
        enabled: true,
      }),
    ]);

    await sdk.shutdown();
  });

  it("round-trips dynamic MCP config and enabled state across session recreation", async () => {
    const { createGeneralAgentSdk } = await import("../../src/index.js");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-mcp-persist-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "mcp-persist.jsonl");
    let storedSession: GeneralAgentStoredSession | null = null;

    const sessionStore = {
      async load() {
        return storedSession;
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
      sessionStore,
    });

    const firstSession = sdk.createSession({
      identity: {
        mode: "general",
        sessionId: "sess-mcp-persist",
        sessionKey: "host:default:mcp-persist",
      },
      systemPrompt: "Stay idle.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    firstSession.setDynamicMcpServers({
      echo_server: {
        transport: "stdio",
        command: process.execPath,
        args: [new URL("../fixtures/mcp/echo-server.mjs", import.meta.url).pathname],
      },
    });
    await firstSession.getCurrentQuery()?.toggleMcpServer?.("echo_server", false);
    await sdk.shutdown();

    const restoredSdk = await createGeneralAgentSdk({
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
      sessionStore,
    });

    const restoredSession = restoredSdk.createSession({
      identity: {
        mode: "general",
        sessionId: "sess-mcp-persist",
        sessionKey: "host:default:mcp-persist",
      },
      systemPrompt: "Stay idle.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    const restoredStatus = await restoredSession.getCurrentQuery()?.mcpServerStatus?.();
    expect(restoredSession.getDynamicMcpServers()).toEqual({
      echo_server: {
        transport: "stdio",
        command: process.execPath,
        args: [new URL("../fixtures/mcp/echo-server.mjs", import.meta.url).pathname],
      },
    });
    expect(restoredStatus).toEqual([
      expect.objectContaining({
        serverName: "echo_server",
        enabled: false,
      }),
    ]);

    await restoredSdk.shutdown();
  });
});
