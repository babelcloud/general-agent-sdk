import { z } from "zod";
import type { GeneralAgentTool, GeneralAgentToolResult } from "../tool-interface.js";

/**
 * Context required by the subagent tool to delegate child session creation
 * to the SDK session that owns it.
 */
export interface SubagentToolContext {
  /**
   * Called by the subagent tool to create and run a child session.
   * The host SDK session provides this callback.
   */
  runChildSession: (params: SubagentRunParams) => Promise<SubagentRunResult>;
}

/**
 * Parameters passed to the child session runner.
 */
export interface SubagentRunParams {
  /** Scoped instructions for the child agent */
  instructions: string;
  /** The task/query for the child to perform */
  task: string;
  /** Optional label for identification */
  label?: string;
  /** Optional model override for the child */
  modelRef?: string;
  /** Optional list of tool names the child is allowed to use */
  allowedTools?: string[];
}

/**
 * Result returned from a completed child session run.
 */
export interface SubagentRunResult {
  /** Whether the child completed successfully */
  ok: boolean;
  /** The child's final output text */
  output: string;
  /** Child session ID for reference */
  childSessionId: string;
  /** Error message if failed */
  error?: string;
}

const SubagentParamsSchema = z.object({
  instructions: z.string().describe("System instructions for the subagent"),
  task: z.string().describe("The task or question for the subagent to work on"),
  label: z.string().optional().describe("Optional label for the subagent"),
  modelRef: z.string().optional().describe("Optional model reference override"),
  allowedTools: z.array(z.string()).optional().describe("Optional list of allowed tool names"),
});

export function createSubagentTool(context: SubagentToolContext): GeneralAgentTool {
  return {
    name: "subagents",
    description:
      "Delegate a task to a subagent. The subagent runs autonomously with its own message history, " +
      "scoped instructions, and scoped tool access. Returns the subagent's output when complete.",
    parameters: SubagentParamsSchema,
    async execute(
      _callId: string,
      params: unknown,
      _signal?: AbortSignal,
    ): Promise<GeneralAgentToolResult> {
      const parsed = SubagentParamsSchema.parse(params);

      const result = await context.runChildSession({
        instructions: parsed.instructions,
        task: parsed.task,
        label: parsed.label,
        modelRef: parsed.modelRef,
        allowedTools: parsed.allowedTools,
      });

      if (!result.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Subagent failed: ${result.error ?? "unknown error"}`,
            },
          ],
          details: {
            childSessionId: result.childSessionId,
            ok: false,
            error: result.error,
          },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: result.output,
          },
        ],
        details: {
          childSessionId: result.childSessionId,
          ok: true,
        },
      };
    },
  };
}
