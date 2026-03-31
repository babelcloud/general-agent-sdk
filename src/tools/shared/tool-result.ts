import type { GeneralAgentToolResult } from "../tool-interface.js";

export function textResult(text: string, details?: unknown): GeneralAgentToolResult {
  return { content: [{ type: "text", text }], details };
}

export function jsonResult(data: unknown): GeneralAgentToolResult {
  return textResult(
    typeof data === "string" ? data : JSON.stringify(data, null, 2),
    data,
  );
}

export function failedTextResult(
  message: string,
  details: unknown = { error: message },
): GeneralAgentToolResult {
  return textResult(`Error: ${message}`, details);
}

export function imageResult(
  data: string,
  mimeType: string,
  details?: unknown,
): GeneralAgentToolResult {
  return {
    content: [
      {
        type: "image",
        source: { type: "base64", media_type: mimeType, data },
      },
    ],
    details,
  };
}
