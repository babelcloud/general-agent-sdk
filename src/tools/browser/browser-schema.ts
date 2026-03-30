import { z } from "zod";

/**
 * Browser tool schema — flat object (not union) for LLM compatibility.
 * 16 actions, covering navigation, interaction, and inspection.
 */
export const browserSchema = z.object({
	action: z.enum([
		"navigate",
		"click",
		"type",
		"scroll_down",
		"scroll_up",
		"snapshot",
		"screenshot",
		"tabs",
		"new_tab",
		"close_tab",
		"select_tab",
		"go_back",
		"go_forward",
		"console_logs",
		"evaluate",
		"wait",
	]).describe("Browser action to perform"),
	url: z.string().optional().describe("URL to navigate to (for navigate action)"),
	selector: z.string().optional().describe("CSS selector or accessibility ref (for click, type actions)"),
	text: z.string().optional().describe("Text to type (for type action)"),
	code: z.string().optional().describe("JavaScript to evaluate (for evaluate action)"),
	tabIndex: z.number().optional().describe("Tab index (for select_tab, close_tab actions)"),
	waitMs: z.number().optional().describe("Milliseconds to wait (for wait action)"),
});

export type BrowserInput = z.infer<typeof browserSchema>;
