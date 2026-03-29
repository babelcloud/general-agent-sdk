/**
 * Provider abstraction — decouples the agentic loop from specific LLM APIs.
 */

export interface ProviderMessage {
  role: "user" | "assistant";
  content: ProviderContentBlock[];
}

export type ProviderContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface ProviderToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ProviderStreamChunk {
  type:
    | "text_delta"
    | "thinking_delta"
    | "thinking_end"
    | "tool_use_start"
    | "tool_use_delta"
    | "content_block_stop"
    | "message_stop"
    | "usage";
  /** For text_delta / thinking_delta */
  text?: string;
  /** For tool_use_start */
  toolUse?: { id: string; name: string };
  /** For tool_use_delta */
  partialJson?: string;
  /** For usage */
  usage?: { input_tokens: number; output_tokens: number };
  /** message-level stop reason */
  stopReason?: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
}

export interface ProviderRequest {
  model: string;
  systemPrompt: string;
  messages: ProviderMessage[];
  tools: ProviderToolDefinition[];
  maxTokens?: number;
}

export interface LLMProvider {
  stream(request: ProviderRequest): AsyncIterable<ProviderStreamChunk>;
}
