export type GeneralAgentToolClassification =
	| "core-built-in"
	| "optional-built-in"
	| "host-bridged"
	| "out-of-scope";

export type GeneralAgentOptionalToolStatus =
	| "implemented"
	| "pending"
	| "blocked"
	| "deferred";

export type GeneralAgentToolPluginSurface = "none" | "web-only";

export type GeneralAgentToolCatalogEntry = {
	name: string;
	classification: GeneralAgentToolClassification;
	implementationStatus?: GeneralAgentOptionalToolStatus;
	pluginSurface: GeneralAgentToolPluginSurface;
};

const TOOL_CATALOG: ReadonlyArray<GeneralAgentToolCatalogEntry> = [
	{ name: "read", classification: "core-built-in", implementationStatus: "implemented", pluginSurface: "none" },
	{ name: "write", classification: "core-built-in", implementationStatus: "implemented", pluginSurface: "none" },
	{ name: "edit", classification: "core-built-in", implementationStatus: "implemented", pluginSurface: "none" },
	{ name: "apply_patch", classification: "core-built-in", implementationStatus: "implemented", pluginSurface: "none" },
	{ name: "exec", classification: "core-built-in", implementationStatus: "implemented", pluginSurface: "none" },
	{ name: "process", classification: "core-built-in", implementationStatus: "implemented", pluginSurface: "none" },
	{ name: "web_search", classification: "core-built-in", implementationStatus: "implemented", pluginSurface: "web-only" },
	{ name: "web_fetch", classification: "core-built-in", implementationStatus: "implemented", pluginSurface: "web-only" },
	{ name: "browser", classification: "optional-built-in", implementationStatus: "pending", pluginSurface: "web-only" },
	{ name: "canvas", classification: "optional-built-in", implementationStatus: "pending", pluginSurface: "none" },
	{ name: "message", classification: "out-of-scope", implementationStatus: "deferred", pluginSurface: "none" },
	{ name: "gateway", classification: "out-of-scope", implementationStatus: "deferred", pluginSurface: "none" },
	{ name: "cron", classification: "out-of-scope", implementationStatus: "deferred", pluginSurface: "none" },
	{ name: "nodes", classification: "out-of-scope", implementationStatus: "deferred", pluginSurface: "none" },
	{ name: "agents_list", classification: "optional-built-in", implementationStatus: "pending", pluginSurface: "none" },
	{ name: "sessions_list", classification: "out-of-scope", implementationStatus: "deferred", pluginSurface: "none" },
	{ name: "sessions_history", classification: "out-of-scope", implementationStatus: "deferred", pluginSurface: "none" },
	{ name: "sessions_send", classification: "out-of-scope", implementationStatus: "deferred", pluginSurface: "none" },
	{ name: "subagents", classification: "core-built-in", implementationStatus: "implemented", pluginSurface: "none" },
	{ name: "session_status", classification: "optional-built-in", implementationStatus: "pending", pluginSurface: "none" },
	{ name: "memory_get", classification: "optional-built-in", implementationStatus: "pending", pluginSurface: "none" },
	{ name: "memory_search", classification: "optional-built-in", implementationStatus: "pending", pluginSurface: "none" },
	{ name: "sessions_spawn", classification: "optional-built-in", implementationStatus: "pending", pluginSurface: "none" },
	{ name: "sessions_yield", classification: "optional-built-in", implementationStatus: "pending", pluginSurface: "none" },
	{ name: "tts", classification: "optional-built-in", implementationStatus: "pending", pluginSurface: "none" },
] as const;

const TOOL_CATALOG_BY_NAME = new Map(
	TOOL_CATALOG.map((entry) => [entry.name, entry] as const),
);

const SDK_RESERVED_TOOL_PREFIXES = ["sessions_"] as const;

export function getToolCatalog(): ReadonlyArray<GeneralAgentToolCatalogEntry> {
	return TOOL_CATALOG;
}

export function getToolCatalogEntry(
	name: string,
): GeneralAgentToolCatalogEntry | undefined {
	return TOOL_CATALOG_BY_NAME.get(name);
}

export function isCoreBuiltInTool(name: string): boolean {
	return getToolCatalogEntry(name)?.classification === "core-built-in";
}

export function isOptionalBuiltInTool(name: string): boolean {
	return getToolCatalogEntry(name)?.classification === "optional-built-in";
}

export function isOutOfScopeTool(name: string): boolean {
	return getToolCatalogEntry(name)?.classification === "out-of-scope";
}

export function isSdkReservedToolName(name: string): boolean {
	if (SDK_RESERVED_TOOL_PREFIXES.some((prefix) => name.startsWith(prefix))) {
		return true;
	}
	const entry = getToolCatalogEntry(name);
	return entry !== undefined && entry.classification !== "host-bridged";
}
