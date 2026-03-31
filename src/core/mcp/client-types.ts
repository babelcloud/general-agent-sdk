export type McpListedTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export interface McpClient {
  initialize(): Promise<void>;
  listTools(): Promise<McpListedTool[]>;
  callTool(name: string, args: unknown): Promise<any>;
  close(): Promise<void>;
}
