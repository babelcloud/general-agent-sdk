import { afterEach, describe, expect, it, vi } from "vitest";

import * as webFetchSsrf from "../../../src/tools/web/ssrf.js";
import { assembleLocalTools } from "../../../src/tools/tool-assembly.js";

function makeHeaders(map: Record<string, string>): { get: (key: string) => string | null } {
	return {
		get: (key) => map[key.toLowerCase()] ?? null,
	};
}

describe("tool assembly", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it("includes web_search even when no Brave API key is configured", () => {
		vi.stubEnv("BRAVE_API_KEY", "");
		vi.stubEnv("BRAVE_SEARCH_API_KEY", "");

		const tools = assembleLocalTools("/tmp");

		expect(tools.some((tool) => tool.name === "web_search")).toBe(true);
	});

	it("includes web_search when a Brave API key is provided through assembly options", () => {
		vi.unstubAllEnvs();

		const tools = assembleLocalTools("/tmp", {
			web: {
				search: {
					apiKey: "brave-test",
				},
			},
		});

		expect(tools.some((tool) => tool.name === "web_search")).toBe(true);
	});

	it("passes web_fetch Firecrawl options through assembly", async () => {
		vi.spyOn(webFetchSsrf, "validateUrlForFetch").mockResolvedValue({ safe: true });
		const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("firecrawl.example/v2/scrape")) {
				return {
					ok: true,
					status: 200,
					headers: makeHeaders({ "content-type": "application/json; charset=utf-8" }),
					text: async () =>
						JSON.stringify({
							success: true,
							data: {
								markdown: "assembled firecrawl content",
								metadata: {
									title: "Assembled Firecrawl Title",
									sourceURL: "https://93.184.216.34/page",
									statusCode: 200,
								},
							},
						}),
				} as Response;
			}
			return {
				ok: true,
				status: 200,
				headers: makeHeaders({ "content-type": "text/html; charset=utf-8" }),
				text: async () => "<!doctype html><html><head></head><body></body></html>",
			} as Response;
		});
		global.fetch = mockFetch as typeof global.fetch;

		const tools = assembleLocalTools("/tmp", {
			web: {
				fetch: {
					firecrawl: {
						apiKey: "firecrawl-test",
						baseUrl: "https://firecrawl.example",
					},
				},
			},
		});
		const webFetch = tools.find((tool) => tool.name === "web_fetch");
		if (!webFetch) {
			throw new Error("Expected assembled web_fetch tool");
		}

		const result = await webFetch.execute("call", {
			url: "https://93.184.216.34/empty",
		});
		const details = result.details as { extractor?: string; text?: string } | undefined;

		expect(details?.extractor).toBe("firecrawl");
		expect(details?.text).toContain("assembled firecrawl content");
	});
});
