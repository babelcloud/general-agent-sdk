import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

/**
 * sessions_spawn — spawn an isolated sub-agent session.
 */
export const sessionsSpawnTool: BuiltinTool = {
  definition: {
    name: "sessions_spawn",
    description:
      'Spawn an isolated session (runtime="subagent" or runtime="acp"). ' +
      'mode="run" is one-shot and mode="session" is persistent/thread-bound. ' +
      "Subagents inherit the parent workspace directory automatically.",
    input_schema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Task prompt for the sub-agent.",
        },
        label: {
          type: "string",
          description: "Human-readable label for the spawned session.",
        },
        runtime: {
          type: "string",
          description: 'Runtime type: "subagent" or "acp".',
        },
        agentId: {
          type: "string",
          description: "Agent ID to use (from agents_list).",
        },
        model: {
          type: "string",
          description: "Model override for the sub-agent.",
        },
        cwd: {
          type: "string",
          description: "Working directory override.",
        },
        timeoutSeconds: {
          type: "number",
          description: "Total timeout for the spawned session.",
        },
        runTimeoutSeconds: {
          type: "number",
          description: "Timeout for the run itself.",
        },
        mode: {
          type: "string",
          description: '"run" for one-shot, "session" for persistent.',
        },
        thread: {
          type: "boolean",
          description: "Bind to current thread.",
        },
        cleanup: {
          type: "string",
          description: '"delete" or "keep" the session after completion.',
        },
        sandbox: {
          type: "string",
          description: '"inherit" or "require" sandbox.',
        },
        streamTo: {
          type: "string",
          description: '"parent" to stream output to parent.',
        },
        thinking: {
          type: "string",
          description: "Thinking mode for the sub-agent.",
        },
        attachments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              content: { type: "string" },
              encoding: { type: "string", description: '"utf8" or "base64".' },
              mimeType: { type: "string" },
            },
          },
          description: "Files to attach to the spawned session (max 50).",
        },
        attachAs: {
          type: "object",
          properties: {
            mountPath: { type: "string", description: "Mount path for attachments." },
          },
          description: "How to attach files to the session.",
        },
        resumeSessionId: {
          type: "string",
          description: "Resume an existing session by ID.",
        },
      },
      required: ["task"],
    },
  },

  async execute(input: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const env = ctx.env ?? process.env;
    const gatewayUrl = env.OPENCLAW_GATEWAY_URL;

    if (!gatewayUrl) {
      return {
        content: JSON.stringify({
          error: "not_configured",
          message: "Set OPENCLAW_GATEWAY_URL for sub-agent spawning.",
        }),
        isError: true,
      };
    }

    const timeoutSeconds = typeof input.timeoutSeconds === "number" ? input.timeoutSeconds : 300;

    try {
      const resp = await fetch(`${gatewayUrl}/sessions/spawn`, {
        method: "POST",
        headers: buildHeaders(env),
        body: JSON.stringify({
          ...input,
          parentSessionId: ctx.sessionId,
          cwd: input.cwd ?? ctx.cwd,
        }),
        signal: AbortSignal.timeout((timeoutSeconds + 10) * 1000),
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
        content: JSON.stringify({ error: "spawn_error", message: err instanceof Error ? err.message : String(err) }),
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
