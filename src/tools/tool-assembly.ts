import type { GeneralAgentTool } from "./tool-interface.js";
import type { GeneralAgentSdkToolOptions } from "../public/sdk.js";
import { createReadTool } from "./file/read.js";
import { createWriteTool } from "./file/write.js";
import { createEditTool } from "./file/edit.js";
import { createApplyPatchTool } from "./file/apply-patch.js";
import { createExecTool } from "./exec/exec.js";
import { createProcessTool } from "./exec/process.js";
import { createWebFetchTool } from "./web/web-fetch.js";
import { createWebSearchTool } from "./web/web-search.js";
import { isCoreBuiltInTool } from "../core/tools/tool-catalog.js";
import { createSubagentTool, type SubagentToolContext } from "./subagent/subagent-tool.js";
// import { createBrowserTool } from "./browser/browser.js";

export type LocalToolAssemblyOptions = {
	env?: NodeJS.ProcessEnv;
	web?: GeneralAgentSdkToolOptions["web"];
	subagentContext?: SubagentToolContext;
};

export function assembleLocalTools(
	workspaceDir: string,
	options: LocalToolAssemblyOptions = {},
): GeneralAgentTool[] {
	const toolEntries: Array<{ name: string; tool: GeneralAgentTool | null }> = [
		{ name: "read", tool: createReadTool(workspaceDir) },
		{ name: "write", tool: createWriteTool(workspaceDir) },
		{ name: "edit", tool: createEditTool(workspaceDir) },
		{ name: "apply_patch", tool: createApplyPatchTool(workspaceDir) },
		{ name: "exec", tool: createExecTool(workspaceDir) },
		{ name: "process", tool: createProcessTool() },
	];
	const tools: GeneralAgentTool[] = toolEntries
		.filter((entry) => entry.tool && isCoreBuiltInTool(entry.name))
		.map((entry) => entry.tool as GeneralAgentTool);

	const webFetch = createWebFetchTool({
		...options.web?.fetch,
		env: options.env,
	});
	if (webFetch && isCoreBuiltInTool("web_fetch")) tools.push(webFetch);

	const webSearch = createWebSearchTool({
		...options.web?.search,
		env: options.env,
	});
	if (webSearch && isCoreBuiltInTool("web_search")) tools.push(webSearch);

	if (options.subagentContext && isCoreBuiltInTool("subagents")) {
		tools.push(createSubagentTool(options.subagentContext));
	}

	// Browser requires Playwright — add when available
	// const browser = createBrowserTool();
	// if (browser) tools.push(browser);

	return tools;
}
