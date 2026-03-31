import type { GeneralAgentTool } from "../tool-interface.js";
import { jsonResult } from "../shared/tool-result.js";
import {
	resolveWebSearchDefinition,
	resolveWebSearchProviderId,
	runWebSearch,
} from "./web-search-runtime.js";
import { SEARCH_CACHE, type RuntimeWebSearchMetadata, type WebSearchConfig, type WebSearchProviderEntry } from "./web-search-provider-common.js";

export type WebSearchToolOptions = {
	apiKey?: string;
	enabled?: boolean;
	provider?: string;
	cacheTtlMinutes?: number;
	timeoutSeconds?: number;
	maxResults?: number;
	brave?: WebSearchConfig["brave"];
	duckduckgo?: WebSearchConfig["duckduckgo"];
	env?: NodeJS.ProcessEnv;
	providerId?: string;
	runtimeWebSearch?: RuntimeWebSearchMetadata;
	providers?: WebSearchProviderEntry[];
	runtimeProviders?: WebSearchProviderEntry[];
	preferRuntimeProviders?: boolean;
};

export function createWebSearchTool(options: WebSearchToolOptions = {}): GeneralAgentTool | null {
	const search: WebSearchConfig = {
		enabled: options.enabled,
		provider: options.provider,
		apiKey: options.apiKey,
		cacheTtlMinutes: options.cacheTtlMinutes,
		timeoutSeconds: options.timeoutSeconds,
		maxResults: options.maxResults,
		brave: options.brave,
		duckduckgo: options.duckduckgo,
	};
	const resolved = resolveWebSearchDefinition({
		search,
		env: options.env,
		providerId: options.providerId,
		runtimeWebSearch: options.runtimeWebSearch,
		providers: options.providers,
		runtimeProviders: options.runtimeProviders,
		preferRuntimeProviders: options.preferRuntimeProviders,
	});
	if (!resolved) {
		return null;
	}

	return {
		name: "web_search",
		description: resolved.definition.description,
		parameters: resolved.definition.parameters,
		async execute(callId, params) {
			void callId;
			return jsonResult(await resolved.definition.execute(params as Record<string, unknown>));
		},
	};
}

export const __testing = {
	SEARCH_CACHE,
	resolveSearchProvider: resolveWebSearchProviderId,
	runWebSearch,
};
