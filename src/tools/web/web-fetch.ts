import { z } from "zod";
import { wrapExternalContent, wrapWebContent } from "../../security/external-content.js";
import { jsonResult } from "../shared/tool-result.js";
import type { GeneralAgentTool } from "../tool-interface.js";
import { validateUrlForFetch } from "./ssrf.js";
import {
	extractBasicHtmlContent,
	extractReadableContent,
	htmlToMarkdown,
	markdownToText,
	truncateText,
	type ExtractMode,
} from "./web-fetch-utils.js";
import {
	type CacheEntry,
	DEFAULT_CACHE_TTL_MINUTES,
	DEFAULT_TIMEOUT_SECONDS,
	normalizeCacheKey,
	readCache,
	readResponseText,
	resolveCacheTtlMs,
	resolveTimeoutSeconds,
	withTimeout,
	writeCache,
} from "./web-shared.js";

const EXTRACT_MODES = ["markdown", "text"] as const;
const DEFAULT_FETCH_MAX_CHARS = 50_000;
const DEFAULT_FETCH_MAX_RESPONSE_BYTES = 2_000_000;
const FETCH_MAX_RESPONSE_BYTES_MIN = 32_000;
const FETCH_MAX_RESPONSE_BYTES_MAX = 10_000_000;
const DEFAULT_FETCH_MAX_REDIRECTS = 3;
const DEFAULT_ERROR_MAX_CHARS = 4_000;
const DEFAULT_ERROR_MAX_BYTES = 64_000;
const DEFAULT_FIRECRAWL_BASE_URL = "https://api.firecrawl.dev";
const DEFAULT_FIRECRAWL_MAX_AGE_MS = 172_800_000;
const DEFAULT_FETCH_USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const FETCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();

const webFetchSchema = z.object({
	url: z.string().describe("HTTP or HTTPS URL to fetch."),
	extractMode: z
		.enum(EXTRACT_MODES)
		.optional()
		.describe('Extraction mode ("markdown" or "text").'),
	maxChars: z
		.number()
		.min(100)
		.optional()
		.describe("Maximum characters to return (truncates when exceeded)."),
});

const WEB_FETCH_WRAPPER_WITH_WARNING_OVERHEAD = wrapWebContent("", "web_fetch").length;
const WEB_FETCH_WRAPPER_NO_WARNING_OVERHEAD = wrapExternalContent("", {
	source: "web_fetch",
	includeWarning: false,
}).length;

export type WebFetchToolOptions = {
	cacheTtlMinutes?: number;
	timeoutSeconds?: number;
	maxCharsCap?: number;
	maxResponseBytes?: number;
	maxRedirects?: number;
	userAgent?: string;
	readability?: boolean;
	env?: NodeJS.ProcessEnv;
	firecrawl?: {
		enabled?: boolean;
		apiKey?: string;
		baseUrl?: string;
		onlyMainContent?: boolean;
		maxAgeMs?: number;
		timeoutSeconds?: number;
	};
};

type RunWebFetchParams = {
	url: string;
	extractMode: ExtractMode;
	maxChars: number;
	maxResponseBytes: number;
	maxRedirects: number;
	timeoutSeconds: number;
	cacheTtlMs: number;
	userAgent: string;
	readabilityEnabled: boolean;
	firecrawlEnabled: boolean;
	firecrawlApiKey?: string;
	firecrawlBaseUrl: string;
	firecrawlOnlyMainContent: boolean;
	firecrawlMaxAgeMs: number;
	firecrawlTimeoutSeconds: number;
	signal?: AbortSignal;
};

function resolveMaxChars(value: unknown, fallback: number, cap: number): number {
	const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
	const clamped = Math.max(100, Math.floor(parsed));
	return Math.min(clamped, cap);
}

function resolveMaxResponseBytes(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return DEFAULT_FETCH_MAX_RESPONSE_BYTES;
	}
	const parsed = Math.floor(value);
	return Math.min(FETCH_MAX_RESPONSE_BYTES_MAX, Math.max(FETCH_MAX_RESPONSE_BYTES_MIN, parsed));
}

function normalizeContentType(value: string | null | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	const [raw] = value.split(";");
	const trimmed = raw?.trim();
	return trimmed || undefined;
}

function looksLikeHtml(value: string): boolean {
	const trimmed = value.trimStart();
	if (!trimmed) {
		return false;
	}
	const head = trimmed.slice(0, 256).toLowerCase();
	return head.startsWith("<!doctype html") || head.startsWith("<html");
}

function formatWebFetchErrorDetail(params: {
	detail: string;
	contentType?: string | null;
	maxChars: number;
}): string {
	const { detail, contentType, maxChars } = params;
	if (!detail) {
		return "";
	}
	let text = detail;
	const contentTypeLower = contentType?.toLowerCase();
	if (contentTypeLower?.includes("text/html") || looksLikeHtml(detail)) {
		const rendered = htmlToMarkdown(detail);
		const withTitle = rendered.title ? `${rendered.title}\n${rendered.text}` : rendered.text;
		text = markdownToText(withTitle);
	}
	const truncated = truncateText(text.trim(), maxChars);
	return truncated.text;
}

function wrapWebFetchContent(
	value: string,
	maxChars: number,
): {
	text: string;
	truncated: boolean;
	rawLength: number;
	wrappedLength: number;
} {
	if (maxChars <= 0) {
		return { text: "", truncated: true, rawLength: 0, wrappedLength: 0 };
	}
	const includeWarning = maxChars >= WEB_FETCH_WRAPPER_WITH_WARNING_OVERHEAD;
	const wrapperOverhead = includeWarning
		? WEB_FETCH_WRAPPER_WITH_WARNING_OVERHEAD
		: WEB_FETCH_WRAPPER_NO_WARNING_OVERHEAD;
	if (wrapperOverhead > maxChars) {
		const minimal = includeWarning
			? wrapWebContent("", "web_fetch")
			: wrapExternalContent("", { source: "web_fetch", includeWarning: false });
		const truncatedWrapper = truncateText(minimal, maxChars);
		return {
			text: truncatedWrapper.text,
			truncated: true,
			rawLength: 0,
			wrappedLength: truncatedWrapper.text.length,
		};
	}
	const maxInner = Math.max(0, maxChars - wrapperOverhead);
	let truncated = truncateText(value, maxInner);
	let wrappedText = includeWarning
		? wrapWebContent(truncated.text, "web_fetch")
		: wrapExternalContent(truncated.text, { source: "web_fetch", includeWarning: false });

	if (wrappedText.length > maxChars) {
		const excess = wrappedText.length - maxChars;
		const adjustedMaxInner = Math.max(0, maxInner - excess);
		truncated = truncateText(value, adjustedMaxInner);
		wrappedText = includeWarning
			? wrapWebContent(truncated.text, "web_fetch")
			: wrapExternalContent(truncated.text, { source: "web_fetch", includeWarning: false });
	}

	return {
		text: wrappedText,
		truncated: truncated.truncated,
		rawLength: truncated.text.length,
		wrappedLength: wrappedText.length,
	};
}

function wrapWebFetchField(value: string | undefined): string | undefined {
	if (!value) {
		return value;
	}
	return wrapExternalContent(value, { source: "web_fetch", includeWarning: false });
}

function isRedirectStatus(status: number): boolean {
	return [301, 302, 303, 307, 308].includes(status);
}

function normalizeSecretInput(value: string | undefined): string | undefined {
	const trimmed = value?.replace(/[\r\n]+/g, "").trim();
	return trimmed ? trimmed : undefined;
}

function resolveFirecrawlApiKey(options: WebFetchToolOptions): string | undefined {
	return (
		normalizeSecretInput(options.firecrawl?.apiKey) ||
		normalizeSecretInput(options.env?.FIRECRAWL_API_KEY) ||
		normalizeSecretInput(process.env.FIRECRAWL_API_KEY)
	);
}

function resolveFirecrawlEnabled(options: WebFetchToolOptions, apiKey?: string): boolean {
	if (typeof options.firecrawl?.enabled === "boolean") {
		return options.firecrawl.enabled;
	}
	return Boolean(apiKey);
}

function resolveFirecrawlBaseUrl(options: WebFetchToolOptions): string {
	return (
		normalizeSecretInput(options.firecrawl?.baseUrl) ||
		normalizeSecretInput(options.env?.FIRECRAWL_BASE_URL) ||
		normalizeSecretInput(process.env.FIRECRAWL_BASE_URL) ||
		DEFAULT_FIRECRAWL_BASE_URL
	);
}

function resolveFirecrawlEndpoint(baseUrl: string): string {
	const trimmed = baseUrl.trim();
	if (!trimmed) {
		return `${DEFAULT_FIRECRAWL_BASE_URL}/v2/scrape`;
	}
	try {
		const url = new URL(trimmed);
		if (url.pathname && url.pathname !== "/") {
			return url.toString();
		}
		url.pathname = "/v2/scrape";
		return url.toString();
	} catch {
		return `${DEFAULT_FIRECRAWL_BASE_URL}/v2/scrape`;
	}
}

function resolveFirecrawlOnlyMainContent(options: WebFetchToolOptions): boolean {
	if (typeof options.firecrawl?.onlyMainContent === "boolean") {
		return options.firecrawl.onlyMainContent;
	}
	return true;
}

function resolveFirecrawlMaxAgeMs(options: WebFetchToolOptions): number {
	const value = options.firecrawl?.maxAgeMs;
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return DEFAULT_FIRECRAWL_MAX_AGE_MS;
	}
	return Math.max(0, Math.floor(value));
}

async function readJsonPayload(response: Response): Promise<Record<string, unknown>> {
	const payload = await response.text();
	if (!payload) {
		return {};
	}
	try {
		return JSON.parse(payload) as Record<string, unknown>;
	} catch {
		return {};
	}
}

async function fetchFirecrawlContent(params: {
	url: string;
	extractMode: ExtractMode;
	apiKey: string;
	baseUrl: string;
	onlyMainContent: boolean;
	maxAgeMs: number;
	timeoutSeconds: number;
	signal?: AbortSignal;
}): Promise<{
	text: string;
	title?: string;
	finalUrl?: string;
	status?: number;
	warning?: string;
}> {
	const endpoint = resolveFirecrawlEndpoint(params.baseUrl);
	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${normalizeSecretInput(params.apiKey) ?? ""}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			url: params.url,
			formats: ["markdown"],
			onlyMainContent: params.onlyMainContent,
			timeout: params.timeoutSeconds * 1000,
			maxAge: params.maxAgeMs,
			proxy: "auto",
			storeInCache: true,
		}),
		signal: withTimeout(params.signal, params.timeoutSeconds * 1000),
	});

	const payload = await readJsonPayload(response);
	const success = payload.success !== false;
	const data =
		payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
			? (payload.data as Record<string, unknown>)
			: {};
	const metadata =
		data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
			? (data.metadata as Record<string, unknown>)
			: {};
	if (!response.ok || !success) {
		const detail = typeof payload.error === "string" ? payload.error : response.statusText;
		throw new Error(
			`Firecrawl fetch failed (${response.status}): ${wrapWebContent(detail || response.statusText, "web_fetch")}`.trim(),
		);
	}

	const rawText =
		typeof data.markdown === "string"
			? data.markdown
			: typeof data.content === "string"
				? data.content
				: "";
	const text = params.extractMode === "text" ? markdownToText(rawText) : rawText;
	return {
		text,
		title: typeof metadata.title === "string" ? metadata.title : undefined,
		finalUrl: typeof metadata.sourceURL === "string" ? metadata.sourceURL : undefined,
		status: typeof metadata.statusCode === "number" ? metadata.statusCode : undefined,
		warning: typeof payload.warning === "string" ? payload.warning : undefined,
	};
}

function buildFirecrawlPayload(params: {
	firecrawl: Awaited<ReturnType<typeof fetchFirecrawlContent>>;
	rawUrl: string;
	finalUrlFallback: string;
	statusFallback: number;
	extractMode: ExtractMode;
	maxChars: number;
	tookMs: number;
}): Record<string, unknown> {
	const wrapped = wrapWebFetchContent(params.firecrawl.text, params.maxChars);
	const wrappedTitle = params.firecrawl.title
		? wrapWebFetchField(params.firecrawl.title)
		: undefined;
	return {
		url: params.rawUrl,
		finalUrl: params.firecrawl.finalUrl || params.finalUrlFallback,
		status: params.firecrawl.status ?? params.statusFallback,
		contentType: "text/markdown",
		title: wrappedTitle,
		extractMode: params.extractMode,
		extractor: "firecrawl",
		externalContent: {
			untrusted: true,
			source: "web_fetch",
			wrapped: true,
		},
		truncated: wrapped.truncated,
		length: wrapped.wrappedLength,
		rawLength: wrapped.rawLength,
		wrappedLength: wrapped.wrappedLength,
		fetchedAt: new Date().toISOString(),
		tookMs: params.tookMs,
		text: wrapped.text,
		warning: wrapWebFetchField(params.firecrawl.warning),
	};
}

async function maybeFetchFirecrawlPayload(
	params: RunWebFetchParams & {
		urlToFetch: string;
		finalUrlFallback: string;
		statusFallback: number;
		cacheKey: string;
		tookMs: number;
	},
): Promise<Record<string, unknown> | null> {
	if (!params.firecrawlEnabled || !params.firecrawlApiKey) {
		return null;
	}

	const firecrawl = await fetchFirecrawlContent({
		url: params.urlToFetch,
		extractMode: params.extractMode,
		apiKey: params.firecrawlApiKey,
		baseUrl: params.firecrawlBaseUrl,
		onlyMainContent: params.firecrawlOnlyMainContent,
		maxAgeMs: params.firecrawlMaxAgeMs,
		timeoutSeconds: params.firecrawlTimeoutSeconds,
		signal: params.signal,
	});
	const payload = buildFirecrawlPayload({
		firecrawl,
		rawUrl: params.url,
		finalUrlFallback: params.finalUrlFallback,
		statusFallback: params.statusFallback,
		extractMode: params.extractMode,
		maxChars: params.maxChars,
		tookMs: params.tookMs,
	});
	writeCache(FETCH_CACHE, params.cacheKey, payload, params.cacheTtlMs);
	return payload;
}

async function tryFirecrawlFallback(
	params: RunWebFetchParams & { url: string; extractMode: ExtractMode },
): Promise<{ text: string; title?: string } | null> {
	if (!params.firecrawlEnabled || !params.firecrawlApiKey) {
		return null;
	}
	try {
		const firecrawl = await fetchFirecrawlContent({
			url: params.url,
			extractMode: params.extractMode,
			apiKey: params.firecrawlApiKey,
			baseUrl: params.firecrawlBaseUrl,
			onlyMainContent: params.firecrawlOnlyMainContent,
			maxAgeMs: params.firecrawlMaxAgeMs,
			timeoutSeconds: params.firecrawlTimeoutSeconds,
			signal: params.signal,
		});
		return { text: firecrawl.text, title: firecrawl.title };
	} catch {
		return null;
	}
}

async function fetchWithValidatedRedirects(params: {
	url: string;
	maxRedirects: number;
	timeoutSeconds: number;
	userAgent: string;
	signal?: AbortSignal;
}): Promise<{ response: Response; finalUrl: string }> {
	let currentUrl = params.url;

	for (let redirectCount = 0; redirectCount <= params.maxRedirects; redirectCount += 1) {
		const validation = await validateUrlForFetch(currentUrl);
		if (!validation.safe) {
			throw new Error(`SSRF blocked: ${validation.reason}`);
		}

		const response = await fetch(currentUrl, {
			signal: withTimeout(params.signal, params.timeoutSeconds * 1000),
			headers: {
				Accept: "text/markdown, text/html;q=0.9, */*;q=0.1",
				"User-Agent": params.userAgent,
				"Accept-Language": "en-US,en;q=0.9",
			},
			redirect: "manual",
		});

		const location = response.headers.get("location");
		if (isRedirectStatus(response.status) && location) {
			if (redirectCount >= params.maxRedirects) {
				throw new Error(`Too many redirects fetching ${params.url}`);
			}
			const nextUrl = new URL(location, currentUrl).toString();
			const body = (response as unknown as { body?: { cancel?: () => Promise<void> | void } }).body;
			try {
				await body?.cancel?.();
			} catch {
				// ignore
			}
			currentUrl = nextUrl;
			continue;
		}

		const finalUrl =
			((response as unknown as { url?: string }).url || currentUrl).toString();
		return { response, finalUrl };
	}

	throw new Error(`Too many redirects fetching ${params.url}`);
}

async function runWebFetch(params: RunWebFetchParams): Promise<Record<string, unknown>> {
	const cacheKey = normalizeCacheKey(
		`fetch:${params.url}:${params.extractMode}:${params.maxChars}`,
	);
	const cached = readCache(FETCH_CACHE, cacheKey);
	if (cached) {
		return { ...cached.value, cached: true };
	}

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(params.url);
	} catch {
		throw new Error("Invalid URL: must be http or https");
	}
	if (!["http:", "https:"].includes(parsedUrl.protocol)) {
		throw new Error("Invalid URL: must be http or https");
	}

	const start = Date.now();
	let response: Response;
	let finalUrl = params.url;
	try {
		const fetched = await fetchWithValidatedRedirects({
			url: params.url,
			maxRedirects: params.maxRedirects,
			timeoutSeconds: params.timeoutSeconds,
			userAgent: params.userAgent,
			signal: params.signal,
		});
		response = fetched.response;
		finalUrl = fetched.finalUrl;
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("SSRF blocked:")) {
			throw error;
		}
		const payload = await maybeFetchFirecrawlPayload({
			...params,
			urlToFetch: finalUrl,
			finalUrlFallback: finalUrl,
			statusFallback: 200,
			cacheKey,
			tookMs: Date.now() - start,
		});
		if (payload) {
			return payload;
		}
		throw error;
	}

	if (!response.ok) {
		const payload = await maybeFetchFirecrawlPayload({
			...params,
			urlToFetch: params.url,
			finalUrlFallback: finalUrl,
			statusFallback: response.status,
			cacheKey,
			tookMs: Date.now() - start,
		});
		if (payload) {
			return payload;
		}
		const rawDetailResult = await readResponseText(response, { maxBytes: DEFAULT_ERROR_MAX_BYTES });
		const rawDetail = rawDetailResult.text;
		const detail = formatWebFetchErrorDetail({
			detail: rawDetail,
			contentType: response.headers.get("content-type"),
			maxChars: DEFAULT_ERROR_MAX_CHARS,
		});
		const wrappedDetail = wrapWebFetchContent(
			detail || (response as { statusText?: string }).statusText || `HTTP ${response.status}`,
			DEFAULT_ERROR_MAX_CHARS,
		);
		throw new Error(`Web fetch failed (${response.status}): ${wrappedDetail.text}`);
	}

	const contentType = response.headers.get("content-type") ?? "application/octet-stream";
	const normalizedContentType = normalizeContentType(contentType) ?? "application/octet-stream";
	const bodyResult = await readResponseText(response, { maxBytes: params.maxResponseBytes });
	const body = bodyResult.text;
	const responseTruncatedWarning = bodyResult.truncated
		? `Response body truncated after ${params.maxResponseBytes} bytes.`
		: undefined;

	let title: string | undefined;
	let extractor = "raw";
	let text = body;
	if (contentType.includes("text/markdown")) {
		extractor = "cf-markdown";
		if (params.extractMode === "text") {
			text = markdownToText(body);
		}
	} else if (contentType.includes("text/html")) {
		if (params.readabilityEnabled) {
			const readable = await extractReadableContent({
				html: body,
				url: finalUrl,
				extractMode: params.extractMode,
			});
			if (readable?.text) {
				text = readable.text;
				title = readable.title;
				extractor = "readability";
			} else {
				const firecrawl = await tryFirecrawlFallback({
					...params,
					url: finalUrl,
					extractMode: params.extractMode,
				});
				if (firecrawl) {
					text = firecrawl.text;
					title = firecrawl.title;
					extractor = "firecrawl";
				} else {
					const basic = await extractBasicHtmlContent({
						html: body,
						extractMode: params.extractMode,
					});
					if (basic?.text) {
						text = basic.text;
						title = basic.title;
						extractor = "raw-html";
					} else {
						throw new Error(
							"Web fetch extraction failed: Readability, Firecrawl, and basic HTML cleanup returned no content.",
						);
					}
				}
			}
		} else {
			throw new Error("Web fetch extraction failed: Readability disabled.");
		}
	} else if (contentType.includes("application/json")) {
		try {
			text = JSON.stringify(JSON.parse(body), null, 2);
			extractor = "json";
		} catch {
			text = body;
			extractor = "raw";
		}
	}

	const wrapped = wrapWebFetchContent(text, params.maxChars);
	const payloadContentType =
		extractor === "firecrawl" ? "text/markdown" : normalizedContentType;
	const wrappedTitle = title ? wrapWebFetchField(title) : undefined;
	const wrappedWarning = wrapWebFetchField(responseTruncatedWarning);
	const payload = {
		url: params.url,
		finalUrl,
		status: response.status,
		contentType: payloadContentType,
		title: wrappedTitle,
		extractMode: params.extractMode,
		extractor,
		externalContent: {
			untrusted: true,
			source: "web_fetch",
			wrapped: true,
		},
		truncated: wrapped.truncated,
		length: wrapped.wrappedLength,
		rawLength: wrapped.rawLength,
		wrappedLength: wrapped.wrappedLength,
		fetchedAt: new Date().toISOString(),
		tookMs: Date.now() - start,
		text: wrapped.text,
		warning: wrappedWarning,
	};
	writeCache(FETCH_CACHE, cacheKey, payload, params.cacheTtlMs);
	return payload;
}

export function createWebFetchTool(options: WebFetchToolOptions = {}): GeneralAgentTool | null {
	const timeoutSeconds = resolveTimeoutSeconds(options.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS);
	const maxCharsCap = resolveMaxChars(
		options.maxCharsCap,
		DEFAULT_FETCH_MAX_CHARS,
		DEFAULT_FETCH_MAX_CHARS,
	);
	const maxResponseBytes = resolveMaxResponseBytes(options.maxResponseBytes);
	const maxRedirects =
		typeof options.maxRedirects === "number" && Number.isFinite(options.maxRedirects)
			? Math.max(0, Math.floor(options.maxRedirects))
			: DEFAULT_FETCH_MAX_REDIRECTS;
	const cacheTtlMs = resolveCacheTtlMs(
		options.cacheTtlMinutes,
		DEFAULT_CACHE_TTL_MINUTES,
	);
	const userAgent = options.userAgent || DEFAULT_FETCH_USER_AGENT;
	const readabilityEnabled = options.readability ?? true;
	const firecrawlApiKey = resolveFirecrawlApiKey(options);
	const firecrawlEnabled = resolveFirecrawlEnabled(options, firecrawlApiKey);
	const firecrawlBaseUrl = resolveFirecrawlBaseUrl(options);
	const firecrawlOnlyMainContent = resolveFirecrawlOnlyMainContent(options);
	const firecrawlMaxAgeMs = resolveFirecrawlMaxAgeMs(options);
	const firecrawlTimeoutSeconds = resolveTimeoutSeconds(
		options.firecrawl?.timeoutSeconds,
		timeoutSeconds,
	);

	return {
		name: "web_fetch",
		description:
			"Fetch and extract readable content from a URL (HTML to markdown/text). Use for lightweight page access without browser automation.",
		parameters: webFetchSchema,
		async execute(_callId, params, signal) {
			const parsed = webFetchSchema.parse(params);
			const result = await runWebFetch({
				url: parsed.url,
				extractMode: parsed.extractMode ?? "markdown",
				maxChars: resolveMaxChars(parsed.maxChars, DEFAULT_FETCH_MAX_CHARS, maxCharsCap),
				maxResponseBytes,
				maxRedirects,
				timeoutSeconds,
				cacheTtlMs,
				userAgent,
				readabilityEnabled,
				firecrawlEnabled,
				firecrawlApiKey,
				firecrawlBaseUrl,
				firecrawlOnlyMainContent,
				firecrawlMaxAgeMs,
				firecrawlTimeoutSeconds,
				signal,
			});
			return jsonResult(result);
		},
	};
}
