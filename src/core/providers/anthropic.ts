import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMProvider,
  ProviderRequest,
  ProviderStreamChunk,
  ProviderToolDefinition,
} from "./types.js";

export interface AnthropicProviderOptions {
  apiKey?: string;
  baseURL?: string;
  maxRetries?: number;
}

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor(options: AnthropicProviderOptions = {}) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      maxRetries: options.maxRetries ?? 2,
    });
  }

  async *stream(request: ProviderRequest): AsyncIterable<ProviderStreamChunk> {
    const tools = request.tools.map((t: ProviderToolDefinition) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    }));

    const stream = this.client.messages.stream({
      model: request.model,
      max_tokens: request.maxTokens ?? 16384,
      system: request.systemPrompt,
      messages: request.messages as Anthropic.MessageParam[],
      tools: tools.length > 0 ? tools : undefined,
    });

    let currentToolUse: { id: string; name: string } | null = null;

    for await (const event of stream) {
      switch (event.type) {
        case "content_block_start": {
          const block = event.content_block;
          if (block.type === "tool_use") {
            currentToolUse = { id: block.id, name: block.name };
            yield { type: "tool_use_start", toolUse: currentToolUse };
          } else if (block.type === "thinking") {
            yield { type: "thinking_delta", text: block.thinking };
          }
          break;
        }
        case "content_block_delta": {
          const delta = event.delta;
          if (delta.type === "text_delta") {
            yield { type: "text_delta", text: delta.text };
          } else if (delta.type === "thinking_delta") {
            yield { type: "thinking_delta", text: delta.thinking };
          } else if (delta.type === "input_json_delta") {
            yield { type: "tool_use_delta", partialJson: delta.partial_json };
          }
          break;
        }
        case "content_block_stop": {
          if (currentToolUse) {
            yield { type: "content_block_stop" };
            currentToolUse = null;
          }
          break;
        }
        case "message_delta": {
          const md = event as Anthropic.MessageStreamEvent & {
            usage?: { output_tokens: number };
          };
          yield {
            type: "message_stop",
            stopReason: event.delta.stop_reason as ProviderStreamChunk["stopReason"],
            usage: md.usage
              ? { input_tokens: 0, output_tokens: md.usage.output_tokens }
              : undefined,
          };
          break;
        }
        case "message_start": {
          const msg = event.message;
          if (msg.usage) {
            yield {
              type: "usage",
              usage: {
                input_tokens: msg.usage.input_tokens,
                output_tokens: msg.usage.output_tokens,
              },
            };
          }
          break;
        }
      }
    }
  }
}
