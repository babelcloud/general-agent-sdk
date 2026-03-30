import type { GeneralAgentToolResult } from "../tool-interface.js";

export function textResult(text: string): GeneralAgentToolResult {
  return { content: [{ type: "text", text }] };
}

export function jsonResult(data: unknown): GeneralAgentToolResult {
  return textResult(
    typeof data === "string" ? data : JSON.stringify(data, null, 2),
  );
}

export function failedTextResult(message: string): GeneralAgentToolResult {
  return textResult(`Error: ${message}`);
}

export function imageResult(data: string, mimeType: string): GeneralAgentToolResult {
  return {
    content: [
      {
        type: "image",
        source: { type: "base64", media_type: mimeType, data },
      },
    ],
  };
}
