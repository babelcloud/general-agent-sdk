import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { GeneralAgentMcpStdioServerConfig } from "../../public/types.js";
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

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class StdioMcpClient implements McpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private stdoutBuffer = Buffer.alloc(0);
  private closed = false;

  constructor(
    private readonly config: GeneralAgentMcpStdioServerConfig,
    workspaceDir: string,
  ) {
    this.child = spawn(config.command, config.args ?? [], {
      cwd: config.cwd ?? workspaceDir,
      env: {
        ...process.env,
        ...(config.env ?? {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.on("data", (chunk: Buffer) => {
      this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
      this.drainStdoutBuffer();
    });
    this.child.stderr.on("data", () => {});
    this.child.on("error", (error) => {
      this.failPending(error instanceof Error ? error : new Error(String(error)));
    });
    this.child.on("exit", (code, signal) => {
      if (!this.closed) {
        this.failPending(
          new Error(
            `MCP stdio server exited before completing the request (code=${code ?? "null"}, signal=${signal ?? "null"})`,
          ),
        );
      }
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "general-agent-sdk",
        version: "0.1.0",
      },
    });
    this.notify("notifications/initialized", {});
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
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.failPending(new Error("MCP client closed"));
    this.child.stdin.end();
    if (this.child.exitCode !== null || this.child.killed) {
      return;
    }
    this.child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      this.child.once("exit", () => resolve());
      setTimeout(() => {
        if (this.child.exitCode === null && !this.child.killed) {
          this.child.kill("SIGKILL");
        }
        resolve();
      }, 1_000).unref();
    });
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

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for MCP response to ${method}`));
      }, 30_000);
      timer.unref();

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.writeMessage(payload);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private notify(method: string, params: unknown): void {
    if (this.closed) {
      return;
    }
    this.writeMessage({
      jsonrpc: "2.0",
      method,
      params,
    });
  }

  private writeMessage(message: JsonRpcMessage): void {
    const body = JSON.stringify(message);
    this.child.stdin.write(
      `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`,
      "utf8",
    );
  }

  private drainStdoutBuffer(): void {
    while (true) {
      const headerEnd = this.stdoutBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }

      const headerText = this.stdoutBuffer.subarray(0, headerEnd).toString("utf8");
      const contentLengthMatch = /Content-Length:\s*(\d+)/i.exec(headerText);
      if (!contentLengthMatch) {
        throw new Error("MCP response missing Content-Length header");
      }

      const contentLength = Number(contentLengthMatch[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;
      if (this.stdoutBuffer.length < bodyEnd) {
        return;
      }

      const body = this.stdoutBuffer.subarray(bodyStart, bodyEnd).toString("utf8");
      this.stdoutBuffer = this.stdoutBuffer.subarray(bodyEnd);
      this.handleMessage(JSON.parse(body) as JsonRpcMessage);
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (typeof message.id !== "number") {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error.message));
      return;
    }

    pending.resolve(message.result ?? {});
  }

  private failPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}
