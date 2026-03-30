import { mkdir as fsMkdir, writeFile as fsWriteFile } from "fs/promises";
import { dirname } from "path";
import { z } from "zod";
import type { OpenClawTool, OpenClawToolResult } from "../tool-interface.js";
import { textResult, failedTextResult } from "../shared/tool-result.js";
import { resolveToCwd } from "../shared/path-utils.js";
import { withFileMutationQueue } from "../shared/file-mutation-queue.js";

const writeSchema = z.object({
	path: z.string().describe("Path to the file to write (relative or absolute)"),
	content: z.string().describe("Content to write to the file"),
});

export interface WriteOperations {
	writeFile(filePath: string, content: string): Promise<void>;
	mkdir(dirPath: string): Promise<void>;
}

function createDefaultWriteOperations(): WriteOperations {
	return {
		writeFile: (filePath: string, content: string) => fsWriteFile(filePath, content, "utf-8"),
		mkdir: (dirPath: string) => fsMkdir(dirPath, { recursive: true }),
	};
}

export function createWriteTool(cwd: string, ops?: WriteOperations): OpenClawTool {
	const operations = ops ?? createDefaultWriteOperations();

	return {
		name: "write",
		description: "Write content to a file. Creates parent directories if needed. Overwrites existing files.",
		parameters: writeSchema,
		async execute(callId: string, params: unknown): Promise<OpenClawToolResult> {
			const parsed = writeSchema.parse(params);

			const resolvedPath = resolveToCwd(parsed.path, cwd);
			const dir = dirname(resolvedPath);

			return withFileMutationQueue(resolvedPath, async () => {
				try {
					await operations.mkdir(dir);
					await operations.writeFile(resolvedPath, parsed.content);

					const lineCount = parsed.content.split("\n").length;
					return textResult(`Successfully wrote ${lineCount} lines to ${resolvedPath}`);
				} catch (err) {
					return failedTextResult(`Failed to write file: ${err instanceof Error ? err.message : String(err)}`);
				}
			});
		},
	};
}
