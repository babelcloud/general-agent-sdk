import { describe, expect, it } from "vitest";

import {
	getToolCatalog,
	getToolCatalogEntry,
	isSdkReservedToolName,
} from "../../src/core/tools/tool-catalog.js";
import { isToolAllowedInEmbeddedMode } from "../../src/core/tools/tool-policy.js";

describe("tool catalog", () => {
	it("classifies the OpenClaw tool surface from the source map", () => {
		const catalog = getToolCatalog();
		const names = catalog.map((entry) => entry.name);

		expect(names).toEqual([
			"read",
			"write",
			"edit",
			"apply_patch",
			"exec",
			"process",
			"web_search",
			"web_fetch",
			"browser",
			"canvas",
			"message",
			"gateway",
			"cron",
			"nodes",
			"agents_list",
			"sessions_list",
			"sessions_history",
			"sessions_send",
			"subagents",
			"session_status",
			"memory_get",
			"memory_search",
			"sessions_spawn",
			"sessions_yield",
			"tts",
		]);
		expect(getToolCatalogEntry("web_search")).toMatchObject({
			classification: "core-built-in",
			implementationStatus: "implemented",
			pluginSurface: "web-only",
		});
		expect(getToolCatalogEntry("browser")).toMatchObject({
			classification: "optional-built-in",
		});
		expect(getToolCatalogEntry("message")).toMatchObject({
			classification: "out-of-scope",
		});
		expect(getToolCatalogEntry("sessions_send")).toMatchObject({
			classification: "out-of-scope",
		});
		expect(getToolCatalogEntry("subagents")).toMatchObject({
			classification: "core-built-in",
		});
	});

	it("treats sdk-owned tool names as reserved and blocks them from hosted-tool injection", () => {
		expect(isSdkReservedToolName("read")).toBe(true);
		expect(isSdkReservedToolName("browser")).toBe(true);
		expect(isSdkReservedToolName("gateway")).toBe(true);
		expect(isSdkReservedToolName("subagents")).toBe(true);
		expect(isSdkReservedToolName("finish")).toBe(false);

		expect(isToolAllowedInEmbeddedMode("read")).toBe(false);
		expect(isToolAllowedInEmbeddedMode("browser")).toBe(false);
		expect(isToolAllowedInEmbeddedMode("gateway")).toBe(false);
		expect(isToolAllowedInEmbeddedMode("subagents")).toBe(false);
		expect(isToolAllowedInEmbeddedMode("finish")).toBe(true);
	});
});
