import fs from "node:fs/promises";
import path from "node:path";
import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

/**
 * sessions_history — fetch message history for a session.
 */
export const sessionsHistoryTool: BuiltinTool = {
  definition: {
    name: "sessions_history",
    description: "Fetch message history for a session.",
    input_schema: {
      type: "object",
      properties: {
        sessionKey: {
          type: "string",
          description: "Session key to fetch history for.",
        },
        limit: {
          type: "number",
          description: "Maximum number of messages to return.",
        },
        includeTools: {
          type: "boolean",
          description: "Include tool call/result entries.",
        },
      },
      required: ["sessionKey"],
    },
  },

  async execute(input: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const sessionKey = input.sessionKey as string;
    const limit = typeof input.limit === "number" ? input.limit : 50;
    const includeTools = input.includeTools === true;
    const env = ctx.env ?? process.env;

    // Try gateway first
    const gatewayUrl = env.OPENCLAW_GATEWAY_URL;
    if (gatewayUrl) {
      try {
        const params = new URLSearchParams({ sessionKey, limit: String(limit) });
        if (includeTools) params.set("includeTools", "true");
        const resp = await fetch(`${gatewayUrl}/sessions/history?${params}`, {
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

    // Local mode: try to read transcript file
    const stateDir = ctx.stateDir;
    if (stateDir) {
      try {
        const transcriptPath = path.join(stateDir, "sessions", sessionKey, "transcript.jsonl");
        const content = await fs.readFile(transcriptPath, "utf-8");
        const lines = content.trim().split("\n").filter(Boolean);
        let entries = lines.map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        }).filter(Boolean);

        if (!includeTools) {
          entries = entries.filter(
            (e: Record<string, unknown>) => e.type !== "tool_call" && e.type !== "tool_result",
          );
        }

        // Take last N entries
        entries = entries.slice(-limit);

        return {
          content: JSON.stringify({
            sessionKey,
            messages: entries,
            count: entries.length,
          }),
        };
      } catch {
        return {
          content: JSON.stringify({
            error: "transcript_not_found",
            message: `No transcript found for session ${sessionKey}.`,
          }),
          isError: true,
        };
      }
    }

    return {
      content: JSON.stringify({
        error: "not_configured",
        message: "No gateway or stateDir configured for session history.",
      }),
      isError: true,
    };
  },
};

function buildHeaders(env: Record<string, string | undefined>): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = env.OPENCLAW_GATEWAY_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}
