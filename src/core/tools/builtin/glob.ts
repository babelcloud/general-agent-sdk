import fs from "node:fs/promises";
import path from "node:path";
import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

export const globTool: BuiltinTool = {
  definition: {
    name: "glob",
    description:
      "Find files matching a glob pattern. Returns matching file paths " +
      "sorted by modification time (newest first).",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: 'Glob pattern to match (e.g. "**/*.ts", "src/**/*.js").',
        },
        path: {
          type: "string",
          description: "Directory to search in. Defaults to workspace root.",
        },
      },
      required: ["pattern"],
    },
  },

  async execute(input: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const pattern = input.pattern as string;
    const searchDir = input.path
      ? resolvePath(input.path as string, ctx.cwd)
      : ctx.cwd;

    try {
      const matches = await walkAndMatch(searchDir, pattern);

      if (matches.length === 0) {
        return { content: "No files matched the pattern." };
      }

      // Sort by mtime descending
      const withStats = await Promise.all(
        matches.map(async (filePath) => {
          try {
            const stat = await fs.stat(filePath);
            return { filePath, mtime: stat.mtimeMs };
          } catch {
            return { filePath, mtime: 0 };
          }
        }),
      );
      withStats.sort((a, b) => b.mtime - a.mtime);

      const result = withStats.map((entry) => entry.filePath).join("\n");
      return { content: result };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: `Error searching files: ${msg}`, isError: true };
    }
  },
};

function resolvePath(filePath: string, cwd: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}

/** Simple recursive glob — supports * and ** patterns. */
async function walkAndMatch(dir: string, pattern: string): Promise<string[]> {
  const parts = pattern.split("/");
  return walkRecursive(dir, parts, dir);
}

async function walkRecursive(
  currentDir: string,
  patternParts: string[],
  rootDir: string,
): Promise<string[]> {
  if (patternParts.length === 0) return [];

  const [head, ...rest] = patternParts;
  const results: string[] = [];

  if (head === "**") {
    // Match zero or more directory levels
    // Try matching rest at current level
    results.push(...(await walkRecursive(currentDir, rest, rootDir)));
    // Recurse into subdirectories
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        if (entry.isDirectory()) {
          const subDir = path.join(currentDir, entry.name);
          results.push(...(await walkRecursive(subDir, patternParts, rootDir)));
        }
      }
    } catch {
      /* directory not readable */
    }
  } else if (rest.length === 0) {
    // Final pattern part — match files
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (matchGlobSegment(entry.name, head)) {
          results.push(path.join(currentDir, entry.name));
        }
      }
    } catch {
      /* directory not readable */
    }
  } else {
    // Intermediate directory pattern
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && matchGlobSegment(entry.name, head)) {
          results.push(
            ...(await walkRecursive(path.join(currentDir, entry.name), rest, rootDir)),
          );
        }
      }
    } catch {
      /* directory not readable */
    }
  }

  return results;
}

/** Match a single filename segment against a glob pattern (supports * and ?). */
function matchGlobSegment(name: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$",
  );
  return regex.test(name);
}
