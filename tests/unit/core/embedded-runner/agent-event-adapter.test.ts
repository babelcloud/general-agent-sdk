import { describe, expect, it } from "vitest";
import { adaptAgentEventToStreamEvents } from "../../../../src/core/embedded-runner/agent-event-adapter.js";
import type { AgentEvent } from "../../../../src/loop/agent-types.js";

describe("adaptAgentEventToStreamEvents", () => {
  it("preserves structured details for successful tool results", () => {
    const event: AgentEvent = {
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "process",
      result: {
        content: [{ type: "text", text: "ok" }],
        details: {
          sessionId: "proc-1",
          running: true,
        },
      },
      isError: false,
    };

    expect(adaptAgentEventToStreamEvents(event)).toEqual([
      {
        kind: "tool_result",
        callId: "call-1",
        toolName: "process",
        output: [{ type: "text", text: "ok" }],
        details: {
          sessionId: "proc-1",
          running: true,
        },
      },
    ]);
  });

  it("preserves structured details for tool errors", () => {
    const event: AgentEvent = {
      type: "tool_execution_end",
      toolCallId: "call-2",
      toolName: "exec",
      result: {
        content: [{ type: "text", text: "Command failed" }],
        details: {
          exitCode: 1,
          stderr: "boom",
        },
      },
      isError: true,
    };

    expect(adaptAgentEventToStreamEvents(event)).toEqual([
      {
        kind: "tool_error",
        callId: "call-2",
        toolName: "exec",
        error: "Command failed",
        details: {
          exitCode: 1,
          stderr: "boom",
        },
      },
    ]);
  });
});
