import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

/**
 * subagents — list, kill, or steer spawned sub-agents.
 */
export const subagentsTool: BuiltinTool = {
  definition: {
    name: "subagents",
    description:
      "List, kill, or steer spawned sub-agents for this requester session. " +
      "Use this for sub-agent orchestration.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: 'Action: "list", "kill", or "steer".',
        },
        target: {
          type: "string",
          description: 'Target sub-agent ID or "all" for kill.',
        },
        message: {
          type: "string",
          description: "Corrective message for steer action.",
        },
        recentMinutes: {
          type: "number",
          description: "Only include sub-agents active within this window.",
        },
      },
      required: [],
    },
  },

  async execute(input: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const action = (input.action as string) || "list";
    const env = ctx.env ?? process.env;
    const gatewayUrl = env.OPENCLAW_GATEWAY_URL;

    if (!gatewayUrl) {
      return {
        content: JSON.stringify({
          error: "not_configured",
          message: "Set OPENCLAW_GATEWAY_URL for sub-agent management.",
          action,
        }),
        isError: true,
      };
    }

    try {
      const resp = await fetch(`${gatewayUrl}/subagents`, {
        method: "POST",
        headers: buildHeaders(env),
        body: JSON.stringify({
          action,
          target: input.target,
          message: input.message,
          recentMinutes: input.recentMinutes,
          parentSessionId: ctx.sessionId,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!resp.ok) {
        return {
          content: JSON.stringify({ error: "gateway_error", status: resp.status }),
          isError: true,
        };
      }

      return { content: JSON.stringify(await resp.json()) };
    } catch (err: unknown) {
      return {
        content: JSON.stringify({
          error: "subagents_error",
          message: err instanceof Error ? err.message : String(err),
        }),
        isError: true,
      };
    }
  },
};

function buildHeaders(env: Record<string, string | undefined>): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = env.OPENCLAW_GATEWAY_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}
