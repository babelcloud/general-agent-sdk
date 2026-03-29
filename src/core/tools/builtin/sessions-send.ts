import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

/**
 * sessions_send — send a message into another session.
 */
export const sessionsSendTool: BuiltinTool = {
  definition: {
    name: "sessions_send",
    description: "Send a message into another session. Use sessionKey or label to identify the target.",
    input_schema: {
      type: "object",
      properties: {
        sessionKey: {
          type: "string",
          description: "Target session key.",
        },
        label: {
          type: "string",
          description: "Target session label.",
        },
        agentId: {
          type: "string",
          description: "Target agent ID.",
        },
        message: {
          type: "string",
          description: "Message text to send.",
        },
        timeoutSeconds: {
          type: "number",
          description: "Wait timeout. 0 = fire-and-forget, >0 = wait for response.",
        },
      },
      required: ["message"],
    },
  },

  async execute(input: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const env = ctx.env ?? process.env;
    const gatewayUrl = env.OPENCLAW_GATEWAY_URL;

    if (!gatewayUrl) {
      return {
        content: JSON.stringify({
          error: "not_configured",
          message: "Set OPENCLAW_GATEWAY_URL for cross-session messaging.",
        }),
        isError: true,
      };
    }

    try {
      const resp = await fetch(`${gatewayUrl}/sessions/send`, {
        method: "POST",
        headers: buildHeaders(env),
        body: JSON.stringify({
          sessionKey: input.sessionKey,
          label: input.label,
          agentId: input.agentId,
          message: input.message,
          timeoutSeconds: input.timeoutSeconds,
          fromSessionId: ctx.sessionId,
        }),
        signal: AbortSignal.timeout(
          typeof input.timeoutSeconds === "number"
            ? (input.timeoutSeconds + 5) * 1000
            : 30_000,
        ),
      });

      if (!resp.ok) {
        return {
          content: JSON.stringify({ error: "gateway_error", status: resp.status, body: await resp.text() }),
          isError: true,
        };
      }

      return { content: JSON.stringify(await resp.json()) };
    } catch (err: unknown) {
      return {
        content: JSON.stringify({ error: "send_error", message: err instanceof Error ? err.message : String(err) }),
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
