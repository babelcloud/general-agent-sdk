import type { GeneralAgentStreamEvent } from "../../public/events.js";
import type { VisionClawCompatStreamMessage } from "./types.js";

export function normalizeGeneralAgentEventForVisionClaw(
  event: GeneralAgentStreamEvent,
): VisionClawCompatStreamMessage {
  switch (event.kind) {
    case "assistant_delta":
      return {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: event.text }],
        },
      };
    case "reasoning_delta":
      return {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: event.text }],
        },
      };
    case "tool_call":
    case "hosted_tool_call":
      return {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: event.toolName,
              input: event.input,
              id: event.callId,
            },
          ],
        },
      };
    case "tool_result":
      return {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: event.callId,
              content: event.output,
              is_error: event.isError,
            },
          ],
        },
      };
    case "tool_error":
      return {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: event.callId,
              content: event.error,
              is_error: true,
            },
          ],
        },
      };
    case "turn_complete":
      return {
        type: "result",
        subtype: event.stopReason,
        num_turns: 1,
        usage: { input_tokens: 0, output_tokens: 0 },
        total_cost_usd: 0,
        is_error:
          event.stopReason === "tool_error"
          || event.stopReason.startsWith("error"),
      };
    case "usage_snapshot":
      return {
        type: "system",
        subtype: "usage_snapshot",
        snapshot: event.snapshot,
      };
    case "compaction_started":
      return {
        type: "system",
        subtype: "compaction_started",
        reason: event.reason,
      };
    case "compaction_finished":
      return {
        type: "system",
        subtype: "compaction_finished",
        reason: event.reason,
        tokensAfter: event.tokensAfter,
      };
    case "reasoning_end":
      return {
        type: "system",
        subtype: "reasoning_end",
      };
  }
}
