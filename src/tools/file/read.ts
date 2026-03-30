import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { OpenClawTool, OpenClawToolResult } from "../tool-interface.js";
import { textResult, imageResult, failedTextResult } from "../shared/tool-result.js";
import { resolveReadPath } from "../shared/path-utils.js";
import { truncateHead, DEFAULT_MAX_LINES } from "../shared/truncate.js";
import { detectSupportedImageMimeTypeFromFile } from "../shared/mime.js";

const readSchema = z.object({
	path: z.string().describe("Path to the file to read (relative or absolute)"),
	offset: z.number().optional().describe("Line number to start reading from (1-indexed)"),
	limit: z.number().optional().describe("Maximum number of lines to read"),
});

export interface ReadOperations {
	readFile(filePath: string): Promise<string>;
	readImage(filePath: string): Promise<{ data: string; mimeType: string }>;
	detectImageMime(filePath: string): string | null;
}

function createDefaultReadOperations(): ReadOperations {
	return {
		readFile: (filePath: string) => readFile(filePath, "utf-8"),
		readImage: async (filePath: string) => {
			const data = readFileSync(filePath).toString("base64");
			const mimeType = detectSupportedImageMimeTypeFromFile(filePath) || "image/png";
			return { data, mimeType };
		},
		detectImageMime: (filePath: string) => detectSupportedImageMimeTypeFromFile(filePath),
	};
}

function trimTrailingEmptyLines(text: string): string {
	return text.replace(/\n+$/, "\n");
}

export function createReadTool(cwd: string, ops?: ReadOperations): OpenClawTool {
	const operations = ops ?? createDefaultReadOperations();

	return {
		name: "read",
		description: "Read a file from the filesystem. Supports text files with optional offset/limit paging and image files (returns base64).",
		parameters: readSchema,
		async execute(callId: string, params: unknown): Promise<OpenClawToolResult> {
			const parsed = readSchema.parse(params);
			const { offset, limit } = parsed;

			const resolvedPath = resolveReadPath(parsed.path, cwd);
			if (!resolvedPath) {
				return failedTextResult(`File not found: ${parsed.path}`);
			}

			// Check if it's an image
			const mimeType = operations.detectImageMime(resolvedPath);
			if (mimeType) {
				try {
					const { data, mimeType: detectedMime } = await operations.readImage(resolvedPath);
					return imageResult(data, detectedMime);
				} catch (err) {
					return failedTextResult(`Failed to read image: ${err instanceof Error ? err.message : String(err)}`);
				}
			}

			// Read as text
			try {
				let content = await operations.readFile(resolvedPath);
				content = trimTrailingEmptyLines(content);

				const lines = content.split("\n");
				const totalLines = lines.length;

				// Apply offset/limit
				let startLine = 0;
				let endLine = totalLines;
				if (offset !== undefined && offset > 0) {
					startLine = offset - 1; // 1-indexed to 0-indexed
				}
				if (limit !== undefined && limit > 0) {
					endLine = Math.min(startLine + limit, totalLines);
				}

				const selectedLines = lines.slice(startLine, endLine);

				// Add line numbers
				const numberedLines = selectedLines.map((line, i) => {
					const lineNum = startLine + i + 1;
					return `${lineNum}\t${line}`;
				});
				let outputContent = numberedLines.join("\n");

				// Truncate if too long
				const truncated = truncateHead(outputContent, {
					maxLines: DEFAULT_MAX_LINES,
				});

				let result = truncated.content;

				if (truncated.wasTruncated) {
					result += `\n\n[Truncated: showing ${truncated.lineCount} of ${totalLines} total lines. Use offset/limit to read more.]`;
				} else if (offset !== undefined || limit !== undefined) {
					result += `\n\n[Showing lines ${startLine + 1}-${endLine} of ${totalLines} total]`;
				}

				return textResult(result);
			} catch (err) {
				return failedTextResult(`Failed to read file: ${err instanceof Error ? err.message : String(err)}`);
			}
		},
	};
}
