import type { GeneralAgentMcpHttpServerConfig } from "../../public/types.js";
import type { McpClient, McpListedTool } from "./client-types.js";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export class HttpMcpClient implements McpClient {
  private nextId = 1;
  private closed = false;

  constructor(
    private readonly config: GeneralAgentMcpHttpServerConfig,
  ) {}

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "general-agent-sdk",
        version: "0.1.0",
      },
    });
    await this.notify("notifications/initialized", {});
  }

  async listTools(): Promise<McpListedTool[]> {
    const tools: McpListedTool[] = [];
    let cursor: string | undefined;

    while (true) {
      const result = await this.request("tools/list", cursor ? { cursor } : {});
      const pageTools = Array.isArray(result?.tools) ? result.tools : [];
      tools.push(...pageTools);

      if (typeof result?.nextCursor !== "string" || result.nextCursor.length === 0) {
        return tools;
      }
      cursor = result.nextCursor;
    }
  }

  async callTool(name: string, args: unknown): Promise<any> {
    return this.request("tools/call", {
      name,
      arguments: args ?? {},
    });
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private async request(method: string, params: unknown): Promise<any> {
    if (this.closed) {
      throw new Error("MCP client is closed");
    }

    const id = this.nextId++;
    const payload: JsonRpcMessage = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };
    const response = await fetch(this.config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(this.config.headers ?? {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `MCP HTTP server responded ${response.status} ${response.statusText}`.trim(),
      );
    }

    const parsed = (await response.json()) as JsonRpcMessage;
    if (parsed.error) {
      throw new Error(parsed.error.message);
    }
    return parsed.result ?? {};
  }

  private async notify(method: string, params: unknown): Promise<void> {
    if (this.closed) {
      return;
    }

    const response = await fetch(this.config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(this.config.headers ?? {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
      } satisfies JsonRpcMessage),
    });

    if (!response.ok) {
      throw new Error(
        `MCP HTTP server responded ${response.status} ${response.statusText}`.trim(),
      );
    }
  }
}
