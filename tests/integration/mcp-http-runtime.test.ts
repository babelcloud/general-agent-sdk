import http from "node:http";
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
    (tool): tool is AgentTool => tool.name === "echo_http",
  );

  if (!echoTool) {
    throw new Error("echo_http tool missing");
  }

  yield {
    type: "tool_execution_start",
    toolCallId: "call-mcp-http-1",
    toolName: "echo_http",
    args: { text: "hello from http mcp" },
  };

  const result = await echoTool.execute("call-mcp-http-1", { text: "hello from http mcp" });

  yield {
    type: "tool_execution_end",
    toolCallId: "call-mcp-http-1",
    toolName: "echo_http",
    result,
    isError: false,
  };

  yield {
    type: "turn_end",
    message: createAssistantMessage("done"),
    toolResults: [],
  };
}

async function createHttpMcpServer(): Promise<{
  url: string;
  requests: Array<{ headers: http.IncomingHttpHeaders; body: any }>;
  close(): Promise<void>;
}> {
  const requests: Array<{ headers: http.IncomingHttpHeaders; body: any }> = [];

  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push({ headers: req.headers, body });

    if (body.method === "notifications/initialized") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const sendResult = (result: unknown) => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result,
        }),
      );
    };

    if (body.method === "initialize") {
      sendResult({
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "echo-http-test-server",
          version: "0.0.1",
        },
      });
      return;
    }

    if (body.method === "tools/list") {
      sendResult({
        tools: [
          {
            name: "echo_http",
            description: "Echoes the provided text over HTTP MCP.",
            inputSchema: {
              type: "object",
              properties: {
                text: {
                  type: "string",
                },
              },
              required: ["text"],
              additionalProperties: false,
            },
          },
        ],
      });
      return;
    }

    if (body.method === "tools/call") {
      const text = body.params?.arguments?.text ?? "";
      sendResult({
        content: [
          {
            type: "text",
            text: `Echo HTTP: ${text}`,
          },
        ],
        structuredContent: {
          echoedText: text,
          via: "http",
        },
        isError: false,
      });
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test MCP HTTP server");
  }

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    requests,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

describe("MCP http runtime", () => {
  const tempDirs: string[] = [];
  const servers: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    vi.clearAllMocks();
    for (const server of servers.splice(0)) {
      await server.close();
    }
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("injects http MCP tools into the same vendored run and executes them", async () => {
    mockAgentLoop.mockImplementation(singleMcpToolLoop);
    const { createGeneralAgentSdk } = await import("../../src/index.js");
    const mcpServer = await createHttpMcpServer();
    servers.push(mcpServer);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-mcp-http-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "mcp-http.jsonl");

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
        sessionId: "sess-mcp-http",
        sessionKey: "host:default:mcp-http",
      },
      systemPrompt: "Use HTTP MCP tools when available.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    session.setDynamicMcpServers({
      echo_http_server: {
        transport: "http",
        url: mcpServer.url,
        headers: {
          "x-test-token": "http-mcp-token",
        },
      },
    });

    const events = await collect(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: "echo hello" }],
      }),
    );

    expect(
      mockAgentLoop.mock.calls[0]?.[1]?.tools?.some((tool: AgentTool) => tool.name === "echo_http"),
    ).toBe(true);

    expect(events).toContainEqual({
      kind: "tool_call",
      callId: "call-mcp-http-1",
      toolName: "echo_http",
      input: { text: "hello from http mcp" },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "tool_result",
        callId: "call-mcp-http-1",
        toolName: "echo_http",
        details: expect.objectContaining({
          serverName: "echo_http_server",
          structuredContent: {
            echoedText: "hello from http mcp",
            via: "http",
          },
        }),
      }),
    );
    expect(
      mcpServer.requests.some(
        (request) =>
          request.body?.method === "tools/call" &&
          request.headers["x-test-token"] === "http-mcp-token",
      ),
    ).toBe(true);

    await sdk.shutdown();
  });

  it("reports http MCP servers as supported through currentQuery", async () => {
    const { createGeneralAgentSdk } = await import("../../src/index.js");
    const mcpServer = await createHttpMcpServer();
    servers.push(mcpServer);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-mcp-http-status-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "mcp-http-status.jsonl");

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
        sessionId: "sess-mcp-http-status",
        sessionKey: "host:default:mcp-http-status",
      },
      systemPrompt: "Stay idle.",
      modelRef: "openai/gpt-5.4",
      sessionFile,
    });

    session.setDynamicMcpServers({
      echo_http_server: {
        transport: "http",
        url: mcpServer.url,
      },
    });

    const status = await session.getCurrentQuery()?.mcpServerStatus?.();
    expect(status).toEqual([
      expect.objectContaining({
        serverName: "echo_http_server",
        transport: "http",
        enabled: true,
        supported: true,
        error: undefined,
      }),
    ]);

    await sdk.shutdown();
  });
});
