import type { OpenClawTool } from "../tool-interface.js";
import { textResult, failedTextResult } from "../shared/tool-result.js";
import { browserSchema, type BrowserInput } from "./browser-schema.js";

/**
 * Create a browser tool (host mode only).
 * Requires Playwright as an optional peer dependency.
 * Returns null if Playwright is not available.
 */
export function createBrowserTool(): OpenClawTool | null {
	// Check if Playwright is available
	try {
		require.resolve("playwright");
	} catch {
		return null;
	}

	return {
		name: "browser",
		description:
			"Control a browser for web interaction. Actions: navigate, click, type, scroll, screenshot, tabs, evaluate JavaScript. Requires Playwright.",
		parameters: browserSchema,
		async execute(callId, params) {
			const input = browserSchema.parse(params) as BrowserInput;

			// Browser tool stub — full implementation requires browser lifecycle management
			return failedTextResult(
				"Browser tool is available but not yet fully implemented. " +
				"Action requested: " + input.action,
			);
		},
	};
}
