import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

/**
 * sessions_list — lists sessions with optional filters.
 */
export const sessionsListTool: BuiltinTool = {
  definition: {
    name: "sessions_list",
    description: "List sessions with optional filters and last messages.",
    input_schema: {
      type: "object",
      properties: {
        kinds: {
          type: "array",
          items: { type: "string" },
          description: "Filter by session kind (main, group, cron, hook, node, other).",
        },
        limit: {
          type: "number",
          description: "Maximum number of sessions to return.",
        },
        activeMinutes: {
          type: "number",
          description: "Only sessions active within this many minutes.",
        },
        messageLimit: {
          type: "number",
          description: "Number of recent messages to include per session.",
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
        if (input.kinds) params.set("kinds", (input.kinds as string[]).join(","));
        if (typeof input.limit === "number") params.set("limit", String(input.limit));
        if (typeof input.activeMinutes === "number") params.set("activeMinutes", String(input.activeMinutes));
        if (typeof input.messageLimit === "number") params.set("messageLimit", String(input.messageLimit));

        const resp = await fetch(`${gatewayUrl}/sessions?${params}`, {
          headers: buildHeaders(env),
          signal: AbortSignal.timeout(10_000),
        });
        if (resp.ok) {
          return { content: JSON.stringify(await resp.json()) };
        }
        return {
          content: JSON.stringify({ error: "gateway_error", status: resp.status }),
          isError: true,
        };
      } catch (err: unknown) {
        return {
          content: JSON.stringify({ error: "fetch_error", message: err instanceof Error ? err.message : String(err) }),
          isError: true,
        };
      }
    }

    // Local mode: return current session only
    return {
      content: JSON.stringify({
        sessions: [
          {
            sessionId: ctx.sessionId ?? "local",
            status: "active",
            kind: "main",
          },
        ],
        note: "Running in local SDK mode. Set OPENCLAW_GATEWAY_URL for multi-session support.",
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
