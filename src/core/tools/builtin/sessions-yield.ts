import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

/**
 * sessions_yield — end current turn and yield to sub-agents.
 */
export const sessionsYieldTool: BuiltinTool = {
  definition: {
    name: "sessions_yield",
    description:
      "End your current turn. Use after spawning subagents to receive their results as the next message.",
    input_schema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Optional status message before yielding.",
        },
      },
      required: [],
    },
  },

  async execute(input: Record<string, unknown>, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const message = (input.message as string) || "Yielded turn.";
    // The agentic loop in sdk-session.ts checks for this tool and can
    // use it as a signal to end the current turn gracefully.
    return {
      content: JSON.stringify({
        yielded: true,
        message,
        note: "Turn ended. Subagent results will arrive as the next message.",
      }),
    };
  },
};
