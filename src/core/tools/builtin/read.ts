import fs from "node:fs/promises";
import path from "node:path";
import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

export const readTool: BuiltinTool = {
  definition: {
    name: "read",
    description:
      "Read the contents of a file. The file_path must be an absolute path. " +
      "By default reads up to 2000 lines from the beginning. " +
      "Use offset and limit for partial reads of large files.",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path to the file to read.",
        },
        offset: {
          type: "number",
          description: "Line number to start reading from (1-based). Optional.",
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to read. Optional, defaults to 2000.",
        },
      },
      required: ["file_path"],
    },
  },

  async execute(input: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const filePath = resolvePath(input.file_path as string, ctx.cwd);
    const offset = typeof input.offset === "number" ? input.offset : 1;
    const limit = typeof input.limit === "number" ? input.limit : 2000;

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");
      const startIdx = Math.max(0, offset - 1);
      const selected = lines.slice(startIdx, startIdx + limit);

      const numbered = selected
        .map((line, i) => {
          const lineNum = String(startIdx + i + 1).padStart(6, " ");
          return `${lineNum}\t${line}`;
        })
        .join("\n");

      return { content: numbered };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: `Error reading file: ${msg}`, isError: true };
    }
  },
};

function resolvePath(filePath: string, cwd: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}
