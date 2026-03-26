import type { OpenClawAgentSdkOptions } from "../../public/sdk.js";

export function initializeEmbeddedPlugins(options: OpenClawAgentSdkOptions): {
  pluginMode: OpenClawAgentSdkOptions["pluginMode"];
  enabledPluginIds: string[];
} {
  return {
    pluginMode: options.pluginMode,
    enabledPluginIds: options.enabledPluginIds ?? [],
  };
}
