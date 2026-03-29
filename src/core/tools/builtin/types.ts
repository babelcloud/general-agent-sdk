import type { ProviderToolDefinition } from "../../providers/types.js";

export interface BuiltinToolContext {
  cwd: string;
  /** Environment variables (falls back to process.env). */
  env?: Record<string, string | undefined>;
  /** Current session ID. */
  sessionId?: string;
  /** Directory for persistent state (transcripts, etc.). */
  stateDir?: string;
  /** Directory for memory files (MEMORY.md, memory/*.md). */
  memoryDir?: string;
}

export interface BuiltinToolResult {
  content: string;
  isError?: boolean;
}

export interface BuiltinTool {
  definition: ProviderToolDefinition;
  execute(input: Record<string, unknown>, context: BuiltinToolContext): Promise<BuiltinToolResult>;
}
