import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

/**
 * tts — convert text to speech.
 *
 * Delegates to a TTS API (OpenAI TTS, ElevenLabs, or gateway).
 * Requires TTS_API_KEY or OPENAI_API_KEY environment variable.
 */
export const ttsTool: BuiltinTool = {
  definition: {
    name: "tts",
    description:
      "Convert text to speech. Audio is delivered automatically from the tool result. " +
      "Requires TTS_API_KEY or OPENAI_API_KEY.",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to convert to speech.",
        },
        channel: {
          type: "string",
          description: "Optional channel id to pick output format (e.g., telegram).",
        },
      },
      required: ["text"],
    },
  },

  async execute(input: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const text = input.text as string;
    if (!text) return { content: "Error: text is required.", isError: true };

    const env = ctx.env ?? process.env;

    // Try gateway first
    const gatewayUrl = env.OPENCLAW_GATEWAY_URL;
    if (gatewayUrl) {
      try {
        const resp = await fetch(`${gatewayUrl}/tts`, {
          method: "POST",
          headers: buildHeaders(env),
          body: JSON.stringify({ text, channel: input.channel }),
          signal: AbortSignal.timeout(30_000),
        });
        if (resp.ok) {
          return { content: JSON.stringify(await resp.json()) };
        }
      } catch {
        // Fall through to direct API
      }
    }

    // Try OpenAI TTS API
    const apiKey = env.TTS_API_KEY || env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        content: JSON.stringify({
          error: "not_configured",
          message: "TTS not available. Set TTS_API_KEY, OPENAI_API_KEY, or OPENCLAW_GATEWAY_URL.",
        }),
        isError: true,
      };
    }

    try {
      const resp = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "tts-1",
          input: text.slice(0, 4096),
          voice: "alloy",
          response_format: "mp3",
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!resp.ok) {
        return {
          content: JSON.stringify({
            error: "tts_api_error",
            status: resp.status,
            message: await resp.text(),
          }),
          isError: true,
        };
      }

      const buffer = await resp.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");

      return {
        content: JSON.stringify({
          text: `Generated speech for ${text.length} characters.`,
          details: {
            audioBase64: base64,
            format: "mp3",
            provider: "openai",
            lengthBytes: buffer.byteLength,
          },
        }),
      };
    } catch (err: unknown) {
      return {
        content: JSON.stringify({
          error: "tts_error",
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
