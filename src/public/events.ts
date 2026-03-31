import type { GeneralAgentUsageSnapshot } from "./types.js";

export type GeneralAgentStreamEvent =
  | { kind: "assistant_delta"; text: string }
  | { kind: "reasoning_delta"; text: string }
  | { kind: "reasoning_end" }
  | { kind: "tool_call"; callId: string; toolName: string; input: Record<string, unknown> }
  | {
      kind: "tool_result";
      callId: string;
      toolName: string;
      output: unknown;
      details?: unknown;
      isError?: boolean;
    }
  | {
      kind: "tool_error";
      callId: string;
      toolName: string;
      error: string;
      details?: unknown;
    }
  | { kind: "hosted_tool_call"; callId: string; toolName: string; input: Record<string, unknown> }
  | { kind: "usage_snapshot"; snapshot: GeneralAgentUsageSnapshot }
  | { kind: "compaction_started"; reason: string }
  | { kind: "compaction_finished"; reason: string; tokensAfter?: number }
  | { kind: "turn_complete"; stopReason: string };
