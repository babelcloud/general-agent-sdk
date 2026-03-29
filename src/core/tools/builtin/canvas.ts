import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

/**
 * Canvas tool — controls node canvases (present/hide/navigate/eval/snapshot/a2ui).
 *
 * Requires a gateway URL to be configured via CANVAS_GATEWAY_URL env var.
 * In standalone SDK mode, this tool returns a "not configured" message
 * unless a gateway is available.
 */
export const canvasTool: BuiltinTool = {
  definition: {
    name: "canvas",
    description:
      "Control node canvases (present/hide/navigate/eval/snapshot). " +
      "Use snapshot to capture the rendered UI. Requires CANVAS_GATEWAY_URL.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description:
            "Canvas action: present, hide, navigate, eval, snapshot, a2ui_push, a2ui_reset.",
        },
        url: {
          type: "string",
          description: "URL for navigate action.",
        },
        target: {
          type: "string",
          description: "Target URL for present action.",
        },
        javaScript: {
          type: "string",
          description: "JavaScript code for eval action.",
        },
        outputFormat: {
          type: "string",
          description: 'Snapshot format: "png", "jpg", "jpeg".',
        },
        maxWidth: {
          type: "number",
          description: "Max width for snapshot.",
        },
        quality: {
          type: "number",
          description: "Image quality for snapshot (0-100).",
        },
        delayMs: {
          type: "number",
          description: "Delay before snapshot.",
        },
        x: { type: "number", description: "Canvas x position." },
        y: { type: "number", description: "Canvas y position." },
        width: { type: "number", description: "Canvas width." },
        height: { type: "number", description: "Canvas height." },
        jsonl: {
          type: "string",
          description: "JSONL data for a2ui_push.",
        },
        jsonlPath: {
          type: "string",
          description: "File path to JSONL data for a2ui_push.",
        },
        gatewayUrl: {
          type: "string",
          description: "Override gateway URL.",
        },
        gatewayToken: {
          type: "string",
          description: "Gateway auth token.",
        },
        node: {
          type: "string",
          description: "Target node ID.",
        },
        timeoutMs: {
          type: "number",
          description: "Request timeout in milliseconds.",
        },
      },
      required: ["action"],
    },
  },

  async execute(input: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const action = input.action as string;
    const env = ctx.env ?? process.env;
    const gatewayUrl = (input.gatewayUrl as string) || env.CANVAS_GATEWAY_URL;

    if (!gatewayUrl) {
      return {
        content: JSON.stringify({
          error: "not_configured",
          message:
            "Canvas gateway is not configured. Set CANVAS_GATEWAY_URL environment variable " +
            "or pass gatewayUrl parameter.",
          action,
        }),
        isError: true,
      };
    }

    const timeoutMs = typeof input.timeoutMs === "number" ? input.timeoutMs : 30_000;
    const token = (input.gatewayToken as string) || env.CANVAS_GATEWAY_TOKEN;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const body: Record<string, unknown> = { action, ...input };
      delete body.gatewayUrl;
      delete body.gatewayToken;

      const resp = await fetch(`${gatewayUrl}/canvas`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!resp.ok) {
        return {
          content: JSON.stringify({
            error: "gateway_error",
            status: resp.status,
            message: await resp.text(),
          }),
          isError: true,
        };
      }

      const result = await resp.json();
      return { content: JSON.stringify(result) };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: JSON.stringify({ error: "canvas_error", message: msg, action }), isError: true };
    }
  },
};
