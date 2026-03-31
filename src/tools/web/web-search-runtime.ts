import { createBraveWebSearchProvider } from "./brave-web-search-provider.js";
import { createDuckDuckGoWebSearchProvider } from "./duckduckgo-web-search-provider.js";
import {
	readProviderEnvValue,
	readConfiguredSecretString,
	type RuntimeWebSearchMetadata,
	type WebSearchConfig,
	type WebSearchProviderEntry,
	type WebSearchProviderToolDefinition,
} from "./web-search-provider-common.js";

export type ResolveWebSearchDefinitionParams = {
	search?: WebSearchConfig;
	env?: NodeJS.ProcessEnv;
	providerId?: string;
	runtimeWebSearch?: RuntimeWebSearchMetadata;
	providers?: WebSearchProviderEntry[];
	runtimeProviders?: WebSearchProviderEntry[];
	preferRuntimeProviders?: boolean;
};

export type RunWebSearchParams = ResolveWebSearchDefinitionParams & {
	args: Record<string, unknown>;
};

function providerRequiresCredential(
	provider: Pick<WebSearchProviderEntry, "requiresCredential">,
): boolean {
	return provider.requiresCredential !== false;
}

function sortWebSearchProviders(providers: WebSearchProviderEntry[]): WebSearchProviderEntry[] {
	return [...providers].sort((left, right) => {
		const order = left.autoDetectOrder - right.autoDetectOrder;
		if (order !== 0) {
			return order;
		}
		return left.id.localeCompare(right.id);
	});
}

function normalizeProviderId(value: string | undefined): string {
	return value?.trim().toLowerCase() ?? "";
}

function getBundledWebSearchProviders(): WebSearchProviderEntry[] {
	return sortWebSearchProviders([
		createBraveWebSearchProvider(),
		createDuckDuckGoWebSearchProvider(),
	]);
}

function hasEntryCredential(
	provider: Pick<WebSearchProviderEntry, "envVars" | "getCredentialValue" | "requiresCredential">,
	search: WebSearchConfig | undefined,
	env: NodeJS.ProcessEnv | undefined,
): boolean {
	if (!providerRequiresCredential(provider)) {
		return true;
	}
	const fromConfig = readConfiguredSecretString(provider.getCredentialValue?.(search));
	return Boolean(fromConfig || readProviderEnvValue(provider.envVars, env));
}

function resolveProviderPool(
	options?: ResolveWebSearchDefinitionParams,
): WebSearchProviderEntry[] {
	const bundledProviders = sortWebSearchProviders(options?.providers ?? getBundledWebSearchProviders());
	const runtimeProviders = sortWebSearchProviders(options?.runtimeProviders ?? []);
	const runtimeProviderId =
		options?.runtimeWebSearch?.selectedProvider ?? options?.runtimeWebSearch?.providerConfigured;
	if (options?.preferRuntimeProviders) {
		return runtimeProviders.length > 0 ? runtimeProviders : bundledProviders;
	}
	if (
		runtimeProviderId &&
		runtimeProviders.some((provider) => provider.id === normalizeProviderId(runtimeProviderId)) &&
		!bundledProviders.some((provider) => provider.id === normalizeProviderId(runtimeProviderId))
	) {
		return runtimeProviders;
	}
	return bundledProviders;
}

export function resolveWebSearchEnabled(params: {
	search?: WebSearchConfig;
}): boolean {
	if (typeof params.search?.enabled === "boolean") {
		return params.search.enabled;
	}
	return true;
}

export function resolveWebSearchProviderId(params: {
	search?: WebSearchConfig;
	env?: NodeJS.ProcessEnv;
	providers?: WebSearchProviderEntry[];
}): string {
	const providers = sortWebSearchProviders(params.providers ?? getBundledWebSearchProviders());
	const raw = normalizeProviderId(params.search?.provider);

	if (raw) {
		const explicit = providers.find((provider) => provider.id === raw);
		if (explicit) {
			return explicit.id;
		}
	}

	if (!raw) {
		let keylessFallbackProviderId = "";
		for (const provider of providers) {
			if (!providerRequiresCredential(provider)) {
				keylessFallbackProviderId ||= provider.id;
				continue;
			}
			if (!hasEntryCredential(provider, params.search, params.env)) {
				continue;
			}
			return provider.id;
		}
		if (keylessFallbackProviderId) {
			return keylessFallbackProviderId;
		}
	}

	return providers[0]?.id ?? "";
}

export function resolveWebSearchDefinition(
	options?: ResolveWebSearchDefinitionParams,
): { provider: WebSearchProviderEntry; definition: WebSearchProviderToolDefinition } | null {
	const search = options?.search;
	if (!resolveWebSearchEnabled({ search })) {
		return null;
	}

	const providers = resolveProviderPool(options).filter(Boolean);
	if (providers.length === 0) {
		return null;
	}

	const providerId =
		normalizeProviderId(options?.providerId) ||
		normalizeProviderId(options?.runtimeWebSearch?.selectedProvider) ||
		normalizeProviderId(options?.runtimeWebSearch?.providerConfigured) ||
		resolveWebSearchProviderId({ search, env: options?.env, providers });
	const provider =
		providers.find((entry) => entry.id === providerId) ??
		providers.find(
			(entry) =>
				entry.id === resolveWebSearchProviderId({ search, env: options?.env, providers }),
		) ??
		providers[0];
	if (!provider) {
		return null;
	}

	const definition = provider.createTool({
		searchConfig: search,
		env: options?.env,
		runtimeMetadata: options?.runtimeWebSearch,
	});
	if (!definition) {
		return null;
	}

	return { provider, definition };
}

export async function runWebSearch(
	params: RunWebSearchParams,
): Promise<{ provider: string; result: Record<string, unknown> }> {
	const resolved = resolveWebSearchDefinition({ ...params, preferRuntimeProviders: true });
	if (!resolved) {
		throw new Error("web_search is disabled or no provider is available.");
	}
	return {
		provider: resolved.provider.id,
		result: await resolved.definition.execute(params.args),
	};
}

export const __testing = {
	resolveSearchProvider: resolveWebSearchProviderId,
};
