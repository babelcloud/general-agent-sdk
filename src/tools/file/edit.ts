import { constants } from "fs";
import { access as fsAccess, readFile as fsReadFile, writeFile as fsWriteFile } from "fs/promises";
import { z } from "zod";
import type { OpenClawTool, OpenClawToolResult } from "../tool-interface.js";
import { textResult, failedTextResult } from "../shared/tool-result.js";
import { resolveToCwd } from "../shared/path-utils.js";
import { withFileMutationQueue } from "../shared/file-mutation-queue.js";
import {
	detectLineEnding,
	normalizeToLF,
	restoreLineEndings,
	normalizeForFuzzyMatch,
	fuzzyFindText,
	stripBom,
	generateDiffString,
} from "./edit-diff.js";

const editSchema = z.object({
	path: z.string().describe("Path to the file to edit (relative or absolute)"),
	oldText: z.string().describe("Exact text to find in the file"),
	newText: z.string().describe("Text to replace the old text with"),
});

export interface EditOperations {
	access(filePath: string): Promise<void>;
	readFile(filePath: string): Promise<Buffer>;
	writeFile(filePath: string, content: string): Promise<void>;
}

const defaultEditOperations: EditOperations = {
	access: (filePath: string) => fsAccess(filePath, constants.R_OK | constants.W_OK),
	readFile: (filePath: string) => fsReadFile(filePath),
	writeFile: (filePath: string, content: string) => fsWriteFile(filePath, content, "utf-8"),
};

export function createEditTool(cwd: string, ops?: EditOperations): OpenClawTool {
	const operations = ops ?? defaultEditOperations;

	return {
		name: "edit",
		description:
			"Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.",
		parameters: editSchema,
		async execute(callId: string, params: unknown, signal?: AbortSignal): Promise<OpenClawToolResult> {
			const parsed = editSchema.parse(params);
			const { path: filePath, oldText, newText } = parsed;

			const absolutePath = resolveToCwd(filePath, cwd);

			return withFileMutationQueue(absolutePath, async () => {
				// Check if file exists
				try {
					await operations.access(absolutePath);
				} catch {
					return failedTextResult(`File not found: ${filePath}`);
				}

				if (signal?.aborted) {
					return failedTextResult("Operation aborted");
				}

				// Read the file
				const buffer = await operations.readFile(absolutePath);
				const rawContent = buffer.toString("utf-8");

				if (signal?.aborted) {
					return failedTextResult("Operation aborted");
				}

				// Strip BOM before matching
				const { bom, text: content } = stripBom(rawContent);

				const originalEnding = detectLineEnding(content);
				const normalizedContent = normalizeToLF(content);
				const normalizedOldText = normalizeToLF(oldText);
				const normalizedNewText = normalizeToLF(newText);

				// Find the old text using fuzzy matching
				const matchResult = fuzzyFindText(normalizedContent, normalizedOldText);

				if (!matchResult.found) {
					return failedTextResult(
						`Could not find the exact text in ${filePath}. The old text must match exactly including all whitespace and newlines.`,
					);
				}

				// Check uniqueness using fuzzy-normalized content
				const fuzzyContent = normalizeForFuzzyMatch(normalizedContent);
				const fuzzyOldText = normalizeForFuzzyMatch(normalizedOldText);
				const occurrences = fuzzyContent.split(fuzzyOldText).length - 1;

				if (occurrences > 1) {
					return failedTextResult(
						`Found ${occurrences} occurrences of the text in ${filePath}. The text must be unique. Please provide more context to make it unique.`,
					);
				}

				if (signal?.aborted) {
					return failedTextResult("Operation aborted");
				}

				// Perform replacement
				const baseContent = matchResult.contentForReplacement;
				const newContent =
					baseContent.substring(0, matchResult.index) +
					normalizedNewText +
					baseContent.substring(matchResult.index + matchResult.matchLength);

				if (baseContent === newContent) {
					return failedTextResult(
						`No changes made to ${filePath}. The replacement produced identical content.`,
					);
				}

				const finalContent = bom + restoreLineEndings(newContent, originalEnding);
				await operations.writeFile(absolutePath, finalContent);

				const diffResult = generateDiffString(baseContent, newContent);

				return textResult(`Successfully replaced text in ${filePath}.\n\n${diffResult.diff}`);
			});
		},
	};
}
