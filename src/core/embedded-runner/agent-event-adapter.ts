import type { OpenClawStreamEvent } from "../../public/events.js";
import type { OpenClawUsageSnapshot } from "../../public/types.js";
import type { AgentEvent } from "../../loop/agent-types.js";
import type { AssistantMessage, AssistantMessageEvent } from "../../providers/anthropic-types.js";

/**
 * Translate a vendored AgentEvent into OpenClawStreamEvent(s).
 * Returns an array because some agent events map to multiple stream events.
 * Returns empty array for events that have no stream equivalent.
 */
export function adaptAgentEventToStreamEvents(
  event: AgentEvent,
): OpenClawStreamEvent[] {
  switch (event.type) {
    case "message_update":
      return adaptMessageUpdate(event.assistantMessageEvent);

    case "tool_execution_start":
      return [
        {
          kind: "tool_call",
          callId: event.toolCallId,
          toolName: event.toolName,
          input: event.args ?? {},
        },
      ];

    case "tool_execution_end":
      if (event.isError) {
        const errorText =
          event.result?.content?.[0]?.type === "text"
            ? (event.result.content[0] as { type: "text"; text: string }).text
            : "Tool execution failed";
        return [
          {
            kind: "tool_error",
            callId: event.toolCallId,
            toolName: event.toolName,
            error: errorText,
          },
        ];
      }
      return [
        {
          kind: "tool_result",
          callId: event.toolCallId,
          toolName: event.toolName,
          output: event.result?.content ?? [],
        },
      ];

    case "message_end": {
      // Extract usage from assistant message if available
      const msg = event.message;
      if (msg && "usage" in msg) {
        const assistantMsg = msg as AssistantMessage;
        const snapshot = extractUsageSnapshot(assistantMsg);
        if (snapshot) {
          return [{ kind: "usage_snapshot", snapshot }];
        }
      }
      return [];
    }

    case "turn_end": {
      const turnMsg = event.message as AssistantMessage | undefined;
      const stopReason = turnMsg?.stopReason === "toolUse"
        ? "tool_use"
        : turnMsg?.stopReason ?? "end_turn";
      return [{ kind: "turn_complete", stopReason }];
    }

    case "agent_end": {
      // Final turn_complete if not already emitted by turn_end
      return [];
    }

    // Silently consumed — no stream equivalent
    case "agent_start":
    case "turn_start":
    case "message_start":
    case "tool_execution_update":
      return [];

    default:
      return [];
  }
}

function adaptMessageUpdate(
  assistantEvent: AssistantMessageEvent,
): OpenClawStreamEvent[] {
  switch (assistantEvent.type) {
    case "text_delta":
      return [{ kind: "assistant_delta", text: assistantEvent.delta }];

    case "thinking_delta":
      return [{ kind: "reasoning_delta", text: assistantEvent.delta }];

    case "thinking_end":
      return [{ kind: "reasoning_end" }];

    // These don't have direct OpenClawStreamEvent equivalents
    case "start":
    case "text_start":
    case "text_end":
    case "thinking_start":
    case "toolcall_start":
    case "toolcall_delta":
    case "toolcall_end":
    case "done":
    case "error":
      return [];

    default:
      return [];
  }
}

function extractUsageSnapshot(msg: AssistantMessage): OpenClawUsageSnapshot | null {
  if (!msg.usage) return null;
  const contextWindow = 200_000;
  return {
    usedInputTokens: msg.usage.input,
    contextWindow,
    usedPct: Number(((msg.usage.input / contextWindow) * 100).toFixed(4)),
    capturedAtMs: Date.now(),
  };
}
