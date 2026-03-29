import fs from "node:fs/promises";
import path from "node:path";
import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

export const writeTool: BuiltinTool = {
  definition: {
    name: "write",
    description:
      "Create or overwrite a file with the provided content. " +
      "The file_path must be an absolute path. Parent directories are created automatically.",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path to the file to write.",
        },
        content: {
          type: "string",
          description: "The content to write to the file.",
        },
      },
      required: ["file_path", "content"],
    },
  },

  async execute(input: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const filePath = resolvePath(input.file_path as string, ctx.cwd);
    const content = input.content as string;

    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");
      return { content: `Successfully wrote ${content.length} characters to ${filePath}` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: `Error writing file: ${msg}`, isError: true };
    }
  },
};

function resolvePath(filePath: string, cwd: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}
