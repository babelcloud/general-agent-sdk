import { z } from "zod";
import type { OpenClawTool } from "../tool-interface.js";
import { textResult, failedTextResult } from "../shared/tool-result.js";

const webSearchSchema = z.object({
	query: z.string().describe("Search query"),
	count: z.number().optional().describe("Number of results (default 5, max 10)"),
});

export function createWebSearchTool(): OpenClawTool | null {
	const apiKey = process.env.BRAVE_SEARCH_API_KEY;
	if (!apiKey) return null;

	return {
		name: "web_search",
		description: "Search the web for information.",
		parameters: webSearchSchema,
		async execute(callId, params) {
			const { query, count = 5 } = webSearchSchema.parse(params);
			const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(count, 10)}`;

			try {
				const res = await fetch(url, {
					headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
				});
				if (!res.ok) return failedTextResult(`Search failed: ${res.status}`);
				const data = await res.json() as any;
				const results = (data.web?.results ?? [])
					.map((r: any) => `**${r.title}**\n${r.url}\n${r.description ?? ""}`)
					.join("\n\n");
				return textResult(results || "No results found.");
			} catch (err) {
				return failedTextResult(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
			}
		},
	};
}
