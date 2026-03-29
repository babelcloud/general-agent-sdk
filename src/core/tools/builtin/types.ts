import type { ProviderToolDefinition } from "../../providers/types.js";

export interface BuiltinToolContext {
  cwd: string;
}

export interface BuiltinToolResult {
  content: string;
  isError?: boolean;
}

export interface BuiltinTool {
  definition: ProviderToolDefinition;
  execute(input: Record<string, unknown>, context: BuiltinToolContext): Promise<BuiltinToolResult>;
}
