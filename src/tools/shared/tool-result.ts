import type { OpenClawToolResult } from "../tool-interface.js";

export function textResult(text: string): OpenClawToolResult {
  return { content: [{ type: "text", text }] };
}

export function jsonResult(data: unknown): OpenClawToolResult {
  return textResult(
    typeof data === "string" ? data : JSON.stringify(data, null, 2),
  );
}

export function failedTextResult(message: string): OpenClawToolResult {
  return textResult(`Error: ${message}`);
}

export function imageResult(data: string, mimeType: string): OpenClawToolResult {
  return {
    content: [
      {
        type: "image",
        source: { type: "base64", media_type: mimeType, data },
      },
    ],
  };
}
