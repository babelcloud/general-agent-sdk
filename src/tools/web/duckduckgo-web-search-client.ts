import {
	buildSearchCacheKey,
	DEFAULT_SEARCH_COUNT,
	readCachedSearchPayload,
	resolveSearchCount,
	resolveSiteName,
	type WebSearchConfig,
	withTrustedWebSearchEndpoint,
	wrapSearchContent,
	writeCachedSearchPayload,
} from "./web-search-provider-common.js";
import { readResponseText, resolveCacheTtlMs, resolveTimeoutSeconds } from "./web-shared.js";

const DDG_HTML_ENDPOINT = "https://html.duckduckgo.com/html";
const DEFAULT_TIMEOUT_SECONDS = 20;
const DDG_SAFE_SEARCH_PARAM: Record<DdgSafeSearch, string> = {
	strict: "1",
	moderate: "-1",
	off: "-2",
};

type DuckDuckGoResult = {
	title: string;
	url: string;
	snippet: string;
};

export type DdgSafeSearch = "strict" | "moderate" | "off";

function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#39;/g, "'")
		.replace(/&#x27;/g, "'")
		.replace(/&#x2F;/g, "/")
		.replace(/&nbsp;/g, " ")
		.replace(/&ndash;/g, "-")
		.replace(/&mdash;/g, "--")
		.replace(/&hellip;/g, "...")
		.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
		.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function stripHtml(html: string): string {
	return html
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function decodeDuckDuckGoUrl(rawUrl: string): string {
	try {
		const normalized = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
		const parsed = new URL(normalized);
		const uddg = parsed.searchParams.get("uddg");
		if (uddg) {
			return uddg;
		}
	} catch {
		// Keep the original value when DuckDuckGo already returns a direct link.
	}
	return rawUrl;
}

function readHrefAttribute(tagAttributes: string): string {
	return /\bhref="([^"]*)"/i.exec(tagAttributes)?.[1] ?? "";
}

function isBotChallenge(html: string): boolean {
	if (/class="[^"]*\bresult__a\b[^"]*"/i.test(html)) {
		return false;
	}
	return /g-recaptcha|are you a human|id="challenge-form"|name="challenge"/i.test(html);
}

function parseDuckDuckGoHtml(html: string): DuckDuckGoResult[] {
	const results: DuckDuckGoResult[] = [];
	const resultRegex = /<a\b(?=[^>]*\bresult__a\b)([^>]*)>([\s\S]*?)<\/a>/gi;
	const nextResultRegex = /<a\b(?=[^>]*\bresult__a\b)[^>]*>/i;
	const snippetRegex = /<a\b(?=[^>]*\bresult__snippet\b)[^>]*>([\s\S]*?)<\/a>/i;

	for (const match of html.matchAll(resultRegex)) {
		const rawAttributes = match[1] ?? "";
		const rawTitle = match[2] ?? "";
		const rawUrl = readHrefAttribute(rawAttributes);
		const matchEnd = (match.index ?? 0) + match[0].length;
		const trailingHtml = html.slice(matchEnd);
		const nextResultIndex = trailingHtml.search(nextResultRegex);
		const scopedTrailingHtml =
			nextResultIndex >= 0 ? trailingHtml.slice(0, nextResultIndex) : trailingHtml;
		const rawSnippet = snippetRegex.exec(scopedTrailingHtml)?.[1] ?? "";
		const title = decodeHtmlEntities(stripHtml(rawTitle));
		const url = decodeDuckDuckGoUrl(decodeHtmlEntities(rawUrl));
		const snippet = decodeHtmlEntities(stripHtml(rawSnippet));

		if (title && url) {
			results.push({ title, url, snippet });
		}
	}

	return results;
}

function resolveDdgRegion(searchConfig?: WebSearchConfig): string | undefined {
	const value = searchConfig?.duckduckgo?.region;
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveDdgSafeSearch(searchConfig?: WebSearchConfig): DdgSafeSearch {
	const value = searchConfig?.duckduckgo?.safeSearch;
	if (value === "strict" || value === "moderate" || value === "off") {
		return value;
	}
	return "moderate";
}

export async function runDuckDuckGoSearch(params: {
	searchConfig?: WebSearchConfig;
	query: string;
	count?: number;
	region?: string;
	safeSearch?: DdgSafeSearch;
	timeoutSeconds?: number;
	cacheTtlMinutes?: number;
}): Promise<Record<string, unknown>> {
	const count = resolveSearchCount(params.count, DEFAULT_SEARCH_COUNT);
	const region = params.region ?? resolveDdgRegion(params.searchConfig);
	const safeSearch =
		params.safeSearch === "strict" ||
		params.safeSearch === "moderate" ||
		params.safeSearch === "off"
			? params.safeSearch
			: resolveDdgSafeSearch(params.searchConfig);
	const timeoutSeconds = resolveTimeoutSeconds(
		params.timeoutSeconds ?? params.searchConfig?.duckduckgo?.timeoutSeconds,
		DEFAULT_TIMEOUT_SECONDS,
	);
	const cacheTtlMs = resolveCacheTtlMs(
		params.cacheTtlMinutes ?? params.searchConfig?.duckduckgo?.cacheTtlMinutes,
		15,
	);
	const cacheKey = buildSearchCacheKey([
		"duckduckgo",
		params.query,
		count,
		region,
		safeSearch,
	]);
	const cached = readCachedSearchPayload(cacheKey);
	if (cached) {
		return cached;
	}

	const url = new URL(DDG_HTML_ENDPOINT);
	url.searchParams.set("q", params.query);
	if (region) {
		url.searchParams.set("kl", region);
	}
	url.searchParams.set("kp", DDG_SAFE_SEARCH_PARAM[safeSearch]);

	const startedAt = Date.now();
	const results = await withTrustedWebSearchEndpoint(
		{
			url: url.toString(),
			timeoutSeconds,
			init: {
				method: "GET",
				headers: {
					"User-Agent":
						"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
				},
			},
		},
		async (response) => {
			if (!response.ok) {
				const detail = (await readResponseText(response, { maxBytes: 64_000 })).text;
				throw new Error(
					`DuckDuckGo search error (${response.status}): ${detail || response.statusText}`,
				);
			}

			const html = await response.text();
			if (isBotChallenge(html)) {
				throw new Error("DuckDuckGo returned a bot-detection challenge.");
			}
			return parseDuckDuckGoHtml(html).slice(0, count);
		},
	);

	const payload = {
		query: params.query,
		provider: "duckduckgo",
		count: results.length,
		tookMs: Date.now() - startedAt,
		externalContent: {
			untrusted: true,
			source: "web_search",
			provider: "duckduckgo",
			wrapped: true,
		},
		results: results.map((result) => ({
			title: wrapSearchContent(result.title),
			url: result.url,
			snippet: result.snippet ? wrapSearchContent(result.snippet) : "",
			siteName: resolveSiteName(result.url) || undefined,
		})),
	} satisfies Record<string, unknown>;

	writeCachedSearchPayload(cacheKey, payload, cacheTtlMs);
	return payload;
}

export const __testing = {
	decodeDuckDuckGoUrl,
	decodeHtmlEntities,
	isBotChallenge,
	parseDuckDuckGoHtml,
};
