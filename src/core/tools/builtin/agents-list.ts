import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

/**
 * agents_list — lists OpenClaw agent IDs available for sessions_spawn.
 *
 * In the SDK, this returns agents from OPENCLAW_AGENTS env var (JSON array)
 * or delegates to a gateway.
 */
export const agentsListTool: BuiltinTool = {
  definition: {
    name: "agents_list",
    description:
      'List OpenClaw agent IDs you can target with sessions_spawn when runtime="subagent".',
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  async execute(_input: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const env = ctx.env ?? process.env;

    // Check for gateway
    const gatewayUrl = env.OPENCLAW_GATEWAY_URL;
    if (gatewayUrl) {
      try {
        const resp = await fetch(`${gatewayUrl}/agents`, {
          headers: buildGatewayHeaders(env),
          signal: AbortSignal.timeout(10_000),
        });
        if (resp.ok) {
          const data = await resp.json();
          return { content: JSON.stringify(data) };
        }
      } catch {
        // Fall through to local config
      }
    }

    // Local config fallback
    const agentsJson = env.OPENCLAW_AGENTS;
    if (agentsJson) {
      try {
        const agents = JSON.parse(agentsJson);
        return { content: JSON.stringify({ agents }) };
      } catch {
        return { content: JSON.stringify({ agents: [], error: "Invalid OPENCLAW_AGENTS JSON." }), isError: true };
      }
    }

    return { content: JSON.stringify({ agents: [], note: "No agents configured. Set OPENCLAW_AGENTS or OPENCLAW_GATEWAY_URL." }) };
  },
};

function buildGatewayHeaders(env: Record<string, string | undefined>): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = env.OPENCLAW_GATEWAY_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}
