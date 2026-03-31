import type { GeneralAgentSdkOptions } from "../../public/sdk.js";

const SUPPORTED_WEB_PLUGIN_IDS = new Set([
  "builtin-web-search",
  "builtin-web-fetch",
  "brave",
  "duckduckgo",
  "exa",
  "firecrawl",
  "google",
  "moonshot",
  "perplexity",
  "tavily",
  "xai",
  "browser",
]);

function normalizePluginId(value: string): string {
  return value.trim().toLowerCase();
}

export function isSupportedWebPluginId(value: string): boolean {
  return SUPPORTED_WEB_PLUGIN_IDS.has(normalizePluginId(value));
}

export function initializeEmbeddedPlugins(options: GeneralAgentSdkOptions): {
  pluginMode: GeneralAgentSdkOptions["pluginMode"];
  enabledPluginIds: string[];
} {
  const enabledPluginIds =
    options.pluginMode === "disabled"
      ? []
      : [...new Set((options.enabledPluginIds ?? []).map(normalizePluginId).filter(isSupportedWebPluginId))];

  return {
    pluginMode: options.pluginMode,
    enabledPluginIds,
  };
}
