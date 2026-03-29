import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

/**
 * session_status — show /status-equivalent session status card.
 */
export const sessionStatusTool: BuiltinTool = {
  definition: {
    name: "session_status",
    description:
      "Show a /status-equivalent session status card (usage + time + cost when available). " +
      "Optional: set per-session model override (model=default resets overrides).",
    input_schema: {
      type: "object",
      properties: {
        sessionKey: {
          type: "string",
          description: "Session key. Uses current session if omitted.",
        },
        model: {
          type: "string",
          description: 'Set per-session model override. Pass "default" to reset.',
        },
      },
      required: [],
    },
  },

  async execute(input: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const env = ctx.env ?? process.env;
    const gatewayUrl = env.OPENCLAW_GATEWAY_URL;

    if (gatewayUrl) {
      try {
        const params = new URLSearchParams();
        if (input.sessionKey) params.set("sessionKey", input.sessionKey as string);
        if (input.model) params.set("model", input.model as string);
        if (ctx.sessionId) params.set("currentSessionId", ctx.sessionId);

        const resp = await fetch(`${gatewayUrl}/sessions/status?${params}`, {
          headers: buildHeaders(env),
          signal: AbortSignal.timeout(10_000),
        });
        if (resp.ok) {
          return { content: JSON.stringify(await resp.json()) };
        }
      } catch {
        // Fall through to local
      }
    }

    // Local mode: return basic status
    return {
      content: JSON.stringify({
        sessionId: ctx.sessionId ?? "local",
        status: "active",
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage().heapUsed,
        nodeVersion: process.version,
        note: "Running in local SDK mode.",
      }),
    };
  },
};

function buildHeaders(env: Record<string, string | undefined>): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = env.OPENCLAW_GATEWAY_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}
