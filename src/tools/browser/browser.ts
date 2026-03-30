import type { OpenClawTool } from "../tool-interface.js";
import { failedTextResult } from "../shared/tool-result.js";
import { browserSchema, type BrowserInput } from "./browser-schema.js";

/**
 * Create a browser tool (host mode only).
 * Requires Playwright as an optional peer dependency.
 * Playwright availability is checked at execution time via dynamic import.
 */
export function createBrowserTool(): OpenClawTool {
	return {
		name: "browser",
		description:
			"Control a browser for web interaction. Actions: navigate, click, type, scroll, screenshot, tabs, evaluate JavaScript. Requires Playwright.",
		parameters: browserSchema,
		async execute(callId, params) {
			const input = browserSchema.parse(params) as BrowserInput;

			try {
				// Dynamic import — works in ESM, throws if playwright not installed
				await import("playwright" as string);
			} catch {
				return failedTextResult(
					"Browser tool requires the 'playwright' package. Install it with: pnpm add playwright",
				);
			}

			// Stub — full implementation requires browser lifecycle management
			return failedTextResult(
				"Browser tool is available but not yet fully implemented. " +
				"Action requested: " + input.action,
			);
		},
	};
}
