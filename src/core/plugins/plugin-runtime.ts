import type { GeneralAgentAgentSdkOptions } from "../../public/sdk.js";

export function initializeEmbeddedPlugins(options: GeneralAgentAgentSdkOptions): {
  pluginMode: GeneralAgentAgentSdkOptions["pluginMode"];
  enabledPluginIds: string[];
} {
  return {
    pluginMode: options.pluginMode,
    enabledPluginIds: options.enabledPluginIds ?? [],
  };
}
