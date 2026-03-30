import type { GeneralAgentTool } from "./tool-interface.js";
import { createReadTool } from "./file/read.js";
import { createWriteTool } from "./file/write.js";
import { createEditTool } from "./file/edit.js";
import { createExecTool } from "./exec/exec.js";
import { createProcessTool } from "./exec/process.js";
import { createWebFetchTool } from "./web/web-fetch.js";
import { createWebSearchTool } from "./web/web-search.js";
// import { createBrowserTool } from "./browser/browser.js";

export function assembleLocalTools(workspaceDir: string): GeneralAgentTool[] {
	const tools: GeneralAgentTool[] = [
		createReadTool(workspaceDir),
		createWriteTool(workspaceDir),
		createEditTool(workspaceDir),
		createExecTool(workspaceDir),
		createProcessTool(),
	];

	const webFetch = createWebFetchTool();
	if (webFetch) tools.push(webFetch);

	const webSearch = createWebSearchTool();
	if (webSearch) tools.push(webSearch);

	// Browser requires Playwright — add when available
	// const browser = createBrowserTool();
	// if (browser) tools.push(browser);

	return tools;
}
