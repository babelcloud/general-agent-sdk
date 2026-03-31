import { z } from "zod";
import { wrapWebContent } from "../../security/external-content.js";
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

export type RuntimeWebSearchMetadata = {
	providerConfigured?: string;
	providerSource?: string;
	selectedProvider?: string;
	selectedProviderKeySource?: string;
	diagnostics?: string[];
};

export type WebSearchConfig = {
	enabled?: boolean;
	provider?: string;
	apiKey?: string;
	cacheTtlMinutes?: number;
	timeoutSeconds?: number;
	maxResults?: number;
	brave?: {
		apiKey?: string;
		mode?: "web" | "llm-context";
	};
	duckduckgo?: {
		region?: string;
		safeSearch?: "strict" | "moderate" | "off";
		timeoutSeconds?: number;
		cacheTtlMinutes?: number;
	};
};

export type WebSearchProviderToolDefinition = {
	description: string;
	parameters: z.ZodTypeAny;
	execute(args: Record<string, unknown>): Promise<Record<string, unknown>>;
};

export type WebSearchProviderContext = {
	searchConfig?: WebSearchConfig;
	env?: NodeJS.ProcessEnv;
	runtimeMetadata?: RuntimeWebSearchMetadata;
};

export type WebSearchProviderEntry = {
	id: string;
	label: string;
	hint: string;
	envVars: string[];
	placeholder: string;
	signupUrl: string;
	credentialPath: string;
	autoDetectOrder: number;
	requiresCredential?: boolean;
	getCredentialValue?: (searchConfig?: WebSearchConfig) => unknown;
	createTool(ctx: WebSearchProviderContext): WebSearchProviderToolDefinition | null;
};

export const DEFAULT_SEARCH_COUNT = 5;
export const MAX_SEARCH_COUNT = 10;

const SEARCH_CACHE_KEY = Symbol.for("general-agent-sdk.web-search.cache");

function getSharedSearchCache(): Map<string, CacheEntry<Record<string, unknown>>> {
	const root = globalThis as Record<PropertyKey, unknown>;
	const existing = root[SEARCH_CACHE_KEY];
	if (existing instanceof Map) {
		return existing as Map<string, CacheEntry<Record<string, unknown>>>;
	}
	const next = new Map<string, CacheEntry<Record<string, unknown>>>();
	root[SEARCH_CACHE_KEY] = next;
	return next;
}

export const SEARCH_CACHE = getSharedSearchCache();

export function normalizeSecretInput(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.replace(/[\r\n]+/g, "").trim();
	return trimmed ? trimmed : undefined;
}

export function resolveSearchTimeoutSeconds(searchConfig?: WebSearchConfig): number {
	return resolveTimeoutSeconds(searchConfig?.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS);
}

export function resolveSearchCacheTtlMs(searchConfig?: WebSearchConfig): number {
	return resolveCacheTtlMs(searchConfig?.cacheTtlMinutes, DEFAULT_CACHE_TTL_MINUTES);
}

export function resolveSearchCount(value: unknown, fallback: number): number {
	const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
	const clamped = Math.max(1, Math.min(MAX_SEARCH_COUNT, Math.floor(parsed)));
	return clamped;
}

export function readConfiguredSecretString(value: unknown): string | undefined {
	return normalizeSecretInput(value) || undefined;
}

export function readProviderEnvValue(
	envVars: string[],
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	for (const envVar of envVars) {
		const value = normalizeSecretInput(env[envVar] ?? process.env[envVar]);
		if (value) {
			return value;
		}
	}
	return undefined;
}

export async function withTrustedWebSearchEndpoint<T>(
	params: {
		url: string;
		timeoutSeconds: number;
		init: RequestInit;
	},
	run: (response: Response) => Promise<T>,
): Promise<T> {
	const signal = withTimeout(
		(params.init.signal as AbortSignal | undefined) ?? undefined,
		params.timeoutSeconds * 1000,
	);
	const response = await fetch(params.url, {
		...params.init,
		signal,
	});
	return await run(response);
}

export async function throwWebSearchApiError(res: Response, providerLabel: string): Promise<never> {
	const detailResult = await readResponseText(res, { maxBytes: 64_000 });
	const detail = detailResult.text.trim();
	throw new Error(`${providerLabel} API error (${res.status}): ${detail || res.statusText}`);
}

export function resolveSiteName(url: string | undefined): string | undefined {
	if (!url) {
		return undefined;
	}
	try {
		return new URL(url).hostname;
	} catch {
		return undefined;
	}
}

export function readCachedSearchPayload(cacheKey: string): Record<string, unknown> | undefined {
	const cached = readCache(SEARCH_CACHE, cacheKey);
	return cached ? { ...cached.value, cached: true } : undefined;
}

export function buildSearchCacheKey(parts: Array<string | number | boolean | undefined>): string {
	return normalizeCacheKey(
		parts.map((part) => (part === undefined ? "default" : String(part))).join(":"),
	);
}

export function writeCachedSearchPayload(
	cacheKey: string,
	payload: Record<string, unknown>,
	ttlMs: number,
): void {
	writeCache(SEARCH_CACHE, cacheKey, payload, ttlMs);
}

export function readStringParam(
	params: Record<string, unknown>,
	name: string,
	options?: { required?: boolean },
): string | undefined {
	const value = params[name];
	if (value == null || value === "") {
		if (options?.required) {
			throw new Error(`${name} is required.`);
		}
		return undefined;
	}
	if (typeof value !== "string") {
		throw new Error(`${name} must be a string.`);
	}
	const trimmed = value.trim();
	if (!trimmed) {
		if (options?.required) {
			throw new Error(`${name} is required.`);
		}
		return undefined;
	}
	return trimmed;
}

export function readNumberParam(
	params: Record<string, unknown>,
	name: string,
	options?: { integer?: boolean },
): number | undefined {
	const value = params[name];
	if (value == null) {
		return undefined;
	}
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${name} must be a number.`);
	}
	if (options?.integer && !Number.isInteger(value)) {
		throw new Error(`${name} must be an integer.`);
	}
	return value;
}

export async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
	const payload = (await readResponseText(response, { maxBytes: 2_000_000 })).text;
	if (!payload) {
		return {};
	}
	try {
		return JSON.parse(payload) as Record<string, unknown>;
	} catch {
		return {};
	}
}

const BRAVE_FRESHNESS_SHORTCUTS = new Set(["pd", "pw", "pm", "py"]);
const BRAVE_FRESHNESS_RANGE = /^(\d{4}-\d{2}-\d{2})to(\d{4}-\d{2}-\d{2})$/;
const PERPLEXITY_RECENCY_VALUES = new Set(["day", "week", "month", "year"]);

export const FRESHNESS_TO_RECENCY: Record<string, string> = {
	pd: "day",
	pw: "week",
	pm: "month",
	py: "year",
};

export const RECENCY_TO_FRESHNESS: Record<string, string> = {
	day: "pd",
	week: "pw",
	month: "pm",
	year: "py",
};

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const PERPLEXITY_DATE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function isValidIsoDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return false;
	}
	const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
		return false;
	}

	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
}

export function normalizeToIsoDate(value: string): string | undefined {
	const trimmed = value.trim();
	if (ISO_DATE_PATTERN.test(trimmed)) {
		return isValidIsoDate(trimmed) ? trimmed : undefined;
	}
	const match = trimmed.match(PERPLEXITY_DATE_PATTERN);
	if (match) {
		const [, month, day, year] = match;
		const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
		return isValidIsoDate(iso) ? iso : undefined;
	}
	return undefined;
}

export function parseIsoDateRange(params: {
	rawDateAfter?: string;
	rawDateBefore?: string;
	invalidDateAfterMessage: string;
	invalidDateBeforeMessage: string;
	invalidDateRangeMessage: string;
	docs?: string;
}):
	| { dateAfter?: string; dateBefore?: string }
	| {
			error: "invalid_date" | "invalid_date_range";
			message: string;
			docs: string;
	  } {
	const docs = params.docs ?? "https://docs.openclaw.ai/tools/web";
	const dateAfter = params.rawDateAfter ? normalizeToIsoDate(params.rawDateAfter) : undefined;
	if (params.rawDateAfter && !dateAfter) {
		return {
			error: "invalid_date",
			message: params.invalidDateAfterMessage,
			docs,
		};
	}

	const dateBefore = params.rawDateBefore ? normalizeToIsoDate(params.rawDateBefore) : undefined;
	if (params.rawDateBefore && !dateBefore) {
		return {
			error: "invalid_date",
			message: params.invalidDateBeforeMessage,
			docs,
		};
	}

	if (dateAfter && dateBefore && dateAfter > dateBefore) {
		return {
			error: "invalid_date_range",
			message: params.invalidDateRangeMessage,
			docs,
		};
	}

	return { dateAfter, dateBefore };
}

export function normalizeFreshness(
	value: string | undefined,
	provider: "brave" | "perplexity",
): string | undefined {
	if (!value) {
		return undefined;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}

	const lower = trimmed.toLowerCase();
	if (BRAVE_FRESHNESS_SHORTCUTS.has(lower)) {
		return provider === "brave" ? lower : FRESHNESS_TO_RECENCY[lower];
	}
	if (PERPLEXITY_RECENCY_VALUES.has(lower)) {
		return provider === "perplexity" ? lower : RECENCY_TO_FRESHNESS[lower];
	}
	if (provider === "brave") {
		const match = trimmed.match(BRAVE_FRESHNESS_RANGE);
		if (match) {
			const [, start, end] = match;
			if (isValidIsoDate(start) && isValidIsoDate(end) && start <= end) {
				return `${start}to${end}`;
			}
		}
	}

	return undefined;
}

export function wrapSearchContent(content: string): string {
	return wrapWebContent(content, "web_search");
}
