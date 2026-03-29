import fs from "node:fs/promises";
import path from "node:path";
import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

export const editTool: BuiltinTool = {
  definition: {
    name: "edit",
    description:
      "Make a precise text replacement in a file. Replaces the first occurrence " +
      "of old_string with new_string. The old_string must match exactly (including " +
      "whitespace and indentation). Use replace_all=true to replace all occurrences.",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path to the file to edit.",
        },
        old_string: {
          type: "string",
          description: "The exact text to find and replace.",
        },
        new_string: {
          type: "string",
          description: "The replacement text.",
        },
        replace_all: {
          type: "boolean",
          description: "Replace all occurrences. Defaults to false.",
        },
      },
      required: ["file_path", "old_string", "new_string"],
    },
  },

  async execute(input: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const filePath = resolvePath(input.file_path as string, ctx.cwd);
    const oldString = input.old_string as string;
    const newString = input.new_string as string;
    const replaceAll = input.replace_all === true;

    try {
      const content = await fs.readFile(filePath, "utf-8");

      if (!content.includes(oldString)) {
        return {
          content: `Error: old_string not found in ${filePath}. Make sure it matches exactly.`,
          isError: true,
        };
      }

      const occurrences = content.split(oldString).length - 1;
      if (occurrences > 1 && !replaceAll) {
        return {
          content:
            `Error: old_string has ${occurrences} occurrences in ${filePath}. ` +
            `Provide more context to make it unique, or use replace_all=true.`,
          isError: true,
        };
      }

      let updated: string;
      if (replaceAll) {
        updated = content.split(oldString).join(newString);
      } else {
        const idx = content.indexOf(oldString);
        updated = content.slice(0, idx) + newString + content.slice(idx + oldString.length);
      }

      await fs.writeFile(filePath, updated, "utf-8");
      const count = replaceAll ? occurrences : 1;
      return { content: `Replaced ${count} occurrence(s) in ${filePath}` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: `Error editing file: ${msg}`, isError: true };
    }
  },
};

function resolvePath(filePath: string, cwd: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}
