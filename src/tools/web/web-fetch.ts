import { z } from "zod";
import type { OpenClawTool } from "../tool-interface.js";
import { textResult, failedTextResult } from "../shared/tool-result.js";
import { validateUrlForFetch } from "./ssrf.js";
import { truncateHead } from "../shared/truncate.js";

const webFetchSchema = z.object({
	url: z.string().describe("URL to fetch"),
	extractMode: z.enum(["text", "raw", "markdown"]).optional().describe("Content extraction mode (default: text)"),
	maxChars: z.number().optional().describe("Maximum characters to return (default 50000)"),
});

/**
 * Simple HTML-to-text extraction (strips tags, collapses whitespace).
 */
function htmlToText(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}

export function createWebFetchTool(): OpenClawTool | null {
	return {
		name: "web_fetch",
		description: "Fetch content from a URL with SSRF protection.",
		parameters: webFetchSchema,
		async execute(callId, params) {
			const parsed = webFetchSchema.parse(params);
			const { url, extractMode = "text", maxChars = 50000 } = parsed;

			// SSRF check
			const validation = await validateUrlForFetch(url);
			if (!validation.safe) {
				return failedTextResult(`SSRF blocked: ${validation.reason}`);
			}

			try {
				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), 30000);

				const response = await fetch(url, {
					signal: controller.signal,
					headers: {
						"User-Agent": "OpenClaw-Agent-SDK/0.1",
						Accept: "text/html, application/json, text/plain, */*",
					},
					redirect: "follow",
				});

				clearTimeout(timeout);

				if (!response.ok) {
					return failedTextResult(`HTTP ${response.status}: ${response.statusText}`);
				}

				const contentType = response.headers.get("content-type") || "";
				const body = await response.text();

				let content: string;
				if (extractMode === "raw" || !contentType.includes("text/html")) {
					content = body;
				} else {
					content = htmlToText(body);
				}

				// Truncate if needed
				if (content.length > maxChars) {
					content = content.substring(0, maxChars) + `\n\n[Truncated: ${content.length} total chars]`;
				}

				return textResult(content);
			} catch (err) {
				return failedTextResult(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
			}
		},
	};
}
