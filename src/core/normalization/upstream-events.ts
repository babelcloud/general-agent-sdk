import type { GeneralAgentStreamEvent } from "../../public/events.js";
import type { GeneralAgentUsageSnapshot } from "../../public/types.js";

export function createHostedToolSuspendEvents(params: {
  callId: string;
  toolName: string;
  input: Record<string, unknown>;
}): GeneralAgentStreamEvent[] {
  return [
    {
      kind: "tool_call",
      callId: params.callId,
      toolName: params.toolName,
      input: params.input,
    },
    {
      kind: "hosted_tool_call",
      callId: params.callId,
      toolName: params.toolName,
      input: params.input,
    },
  ];
}

export function createHostedToolResumeEvents(params: {
  callId: string;
  toolName: string;
  output: unknown;
  isError?: boolean;
}): GeneralAgentStreamEvent[] {
  return [
    {
      kind: "tool_result",
      callId: params.callId,
      toolName: params.toolName,
      output: params.output,
      isError: params.isError,
    },
    {
      kind: "turn_complete",
      stopReason: params.isError ? "tool_error" : "tool_result",
    },
  ];
}

export function createAssistantCompletionEvents(params: {
  text: string;
  stopReason?: string;
  snapshot?: GeneralAgentUsageSnapshot | null;
}): GeneralAgentStreamEvent[] {
  const events: GeneralAgentStreamEvent[] = [];
  if (params.text) {
    events.push({ kind: "assistant_delta", text: params.text });
  }
  if (params.snapshot) {
    events.push({ kind: "usage_snapshot", snapshot: params.snapshot });
  }
  events.push({ kind: "turn_complete", stopReason: params.stopReason ?? "end_turn" });
  return events;
}

export function createStopEvents(reason: string): GeneralAgentStreamEvent[] {
  return [{ kind: "turn_complete", stopReason: reason }];
}
