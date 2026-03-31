import { z } from "zod";
import { runDuckDuckGoSearch, type DdgSafeSearch } from "./duckduckgo-web-search-client.js";
import {
	readNumberParam,
	readStringParam,
	type WebSearchProviderEntry,
} from "./web-search-provider-common.js";

const duckDuckGoSearchSchema = z
	.object({
		query: z.string().describe("Search query string."),
		count: z
			.number()
			.min(1)
			.max(10)
			.optional()
			.describe("Number of results to return (1-10)."),
		region: z
			.string()
			.optional()
			.describe("Optional DuckDuckGo region code such as us-en, uk-en, or de-de."),
		safeSearch: z
			.string()
			.optional()
			.describe("SafeSearch level: strict, moderate, or off."),
	})
	.strict();

export function createDuckDuckGoWebSearchProvider(): WebSearchProviderEntry {
	return {
		id: "duckduckgo",
		label: "DuckDuckGo Search (experimental)",
		hint: "Free web search fallback with no API key required",
		requiresCredential: false,
		envVars: [],
		placeholder: "(no key needed)",
		signupUrl: "https://duckduckgo.com/",
		credentialPath: "",
		autoDetectOrder: 100,
		getCredentialValue: () => "duckduckgo-no-key-needed",
		createTool: ({ searchConfig }) => ({
			description:
				"Search the web using DuckDuckGo. Returns titles, URLs, and snippets with no API key required.",
				parameters: duckDuckGoSearchSchema,
				execute: async (args) =>
					await runDuckDuckGoSearch({
						searchConfig,
						query: readStringParam(args, "query", { required: true }) ?? "",
						count: readNumberParam(args, "count", { integer: true }),
						region: readStringParam(args, "region"),
						safeSearch: readStringParam(args, "safeSearch") as DdgSafeSearch | undefined,
					}),
			}),
	};
}
