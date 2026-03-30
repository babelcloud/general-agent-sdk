import type { Tool } from "@anthropic-ai/sdk/resources/messages.js";
import { z } from "zod";

/**
 * Result returned by tool execution.
 * Content array matches Anthropic's ToolResultBlockParam content format.
 */
export interface GeneralAgentToolResult {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  >;
}

/**
 * SDK-native tool definition. All vendored tools implement this interface.
 * Parameters use Zod schemas (not TypeBox).
 */
export interface GeneralAgentTool {
  name: string;
  description: string;
  parameters: z.ZodType<any>;
  execute(
    callId: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<GeneralAgentToolResult>;
}

/**
 * Convert an SDK tool to the Anthropic API tool definition format.
 */
export function toAnthropicToolDef(tool: GeneralAgentTool): Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: z.toJSONSchema(tool.parameters) as Tool["input_schema"],
  };
}
