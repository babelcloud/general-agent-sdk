import fs from "node:fs/promises";
import path from "node:path";
import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

/**
 * memory_get — safe snippet read from MEMORY.md or memory/*.md.
 * Use after memory_search to pull only the needed lines.
 */
export const memoryGetTool: BuiltinTool = {
  definition: {
    name: "memory_get",
    description:
      "Safe snippet read from MEMORY.md or memory/*.md with optional from/lines; " +
      "use after memory_search to pull only the needed lines and keep context small.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to memory file (e.g., 'MEMORY.md' or 'memory/notes.md').",
        },
        from: {
          type: "number",
          description: "Starting line number (1-based).",
        },
        lines: {
          type: "number",
          description: "Number of lines to read.",
        },
      },
      required: ["path"],
    },
  },

  async execute(input: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const memoryDir = ctx.memoryDir;
    if (!memoryDir) {
      return {
        content: JSON.stringify({
          error: "not_configured",
          message: "Memory directory not configured. Set memoryDir in BuiltinToolContext.",
        }),
        isError: true,
      };
    }

    const relPath = input.path as string;
    // Prevent path traversal
    const resolved = path.resolve(memoryDir, relPath);
    if (!resolved.startsWith(path.resolve(memoryDir))) {
      return {
        content: JSON.stringify({ error: "path_traversal", message: "Path must be within memory directory." }),
        isError: true,
      };
    }

    try {
      const content = await fs.readFile(resolved, "utf-8");
      const allLines = content.split("\n");
      const from = typeof input.from === "number" ? Math.max(1, input.from) : 1;
      const lineCount = typeof input.lines === "number" ? input.lines : allLines.length;
      const startIdx = from - 1;
      const selected = allLines.slice(startIdx, startIdx + lineCount);

      return {
        content: JSON.stringify({
          path: relPath,
          from,
          lines: selected.length,
          totalLines: allLines.length,
          content: selected.join("\n"),
        }),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          content: JSON.stringify({ error: "not_found", path: relPath, message: "File not found." }),
          isError: true,
        };
      }
      return { content: JSON.stringify({ error: "read_error", message: msg }), isError: true };
    }
  },
};
