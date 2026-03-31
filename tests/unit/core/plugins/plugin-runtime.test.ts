import { describe, expect, it } from "vitest";

import { initializeEmbeddedPlugins, isSupportedWebPluginId } from "../../../../src/core/plugins/plugin-runtime.js";
import type { GeneralAgentSdkOptions } from "../../../../src/public/sdk.js";

function createOptions(
	overrides: Partial<GeneralAgentSdkOptions> = {},
): GeneralAgentSdkOptions {
	return {
		workspaceDir: "/tmp/workspace",
		stateDir: "/tmp/state",
		agentDir: "/tmp/agent",
		profileId: "default",
		pluginMode: "disabled",
		logger: {
			onDebug() {},
			onInfo() {},
			onWarn() {},
			onError() {},
		},
		sessionStore: {
			async load() {
				return null;
			},
			async save() {},
			async resolveSessionFile() {
				return "/tmp/state/session.jsonl";
			},
		},
		...overrides,
	};
}

describe("plugin runtime", () => {
	it("keeps only web-scoped plugin ids in allowlisted mode", () => {
		const state = initializeEmbeddedPlugins(
			createOptions({
				pluginMode: "allowlisted",
				enabledPluginIds: ["builtin-web-search", "perplexity", "memory-core", "gateway"],
			}),
		);

		expect(state.pluginMode).toBe("allowlisted");
		expect(state.enabledPluginIds).toEqual(["builtin-web-search", "perplexity"]);
	});

	it("drops plugin ids entirely when plugin mode is disabled", () => {
		const state = initializeEmbeddedPlugins(
			createOptions({
				pluginMode: "disabled",
				enabledPluginIds: ["builtin-web-search", "perplexity"],
			}),
		);

		expect(state.enabledPluginIds).toEqual([]);
	});

	it("recognizes only the supported web plugin ids", () => {
		expect(isSupportedWebPluginId("builtin-web-search")).toBe(true);
		expect(isSupportedWebPluginId("duckduckgo")).toBe(true);
		expect(isSupportedWebPluginId("memory-core")).toBe(false);
		expect(isSupportedWebPluginId("gateway")).toBe(false);
	});
});
