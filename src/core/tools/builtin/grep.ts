import { spawn } from "node:child_process";
import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

export const grepTool: BuiltinTool = {
  definition: {
    name: "grep",
    description:
      "Search file contents using a regular expression pattern. " +
      "Uses ripgrep (rg) if available, falls back to grep -rn.",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regular expression pattern to search for.",
        },
        path: {
          type: "string",
          description: "File or directory to search in. Defaults to workspace root.",
        },
        glob: {
          type: "string",
          description: 'Glob pattern to filter files (e.g. "*.ts").',
        },
        case_insensitive: {
          type: "boolean",
          description: "Case insensitive search. Defaults to false.",
        },
      },
      required: ["pattern"],
    },
  },

  async execute(input: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const pattern = input.pattern as string;
    const searchPath = (input.path as string) || ctx.cwd;
    const glob = input.glob as string | undefined;
    const caseInsensitive = input.case_insensitive === true;

    try {
      const result = await runGrep(pattern, searchPath, glob, caseInsensitive, ctx.cwd);
      if (!result.trim()) {
        return { content: "No matches found." };
      }
      // Limit output to avoid overwhelming the context
      const lines = result.split("\n");
      if (lines.length > 500) {
        return {
          content: lines.slice(0, 500).join("\n") + `\n...(${lines.length - 500} more lines)`,
        };
      }
      return { content: result };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("exit code 1")) {
        return { content: "No matches found." };
      }
      return { content: `Error searching: ${msg}`, isError: true };
    }
  },
};

async function runGrep(
  pattern: string,
  searchPath: string,
  glob: string | undefined,
  caseInsensitive: boolean,
  cwd: string,
): Promise<string> {
  // Try ripgrep first, fall back to grep
  const hasRg = await commandExists("rg");

  const args: string[] = [];
  if (hasRg) {
    args.push("-n", "--no-heading");
    if (caseInsensitive) args.push("-i");
    if (glob) args.push("--glob", glob);
    args.push(pattern, searchPath);
    return execSimple("rg", args, cwd);
  }

  args.push("-rn");
  if (caseInsensitive) args.push("-i");
  if (glob) args.push("--include", glob);
  args.push(pattern, searchPath);
  return execSimple("grep", args, cwd);
}

function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("which", [cmd], { stdio: "ignore" });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

function execSimple(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("close", (code) => {
      if (code === 0 || code === 1) resolve(stdout);
      else reject(new Error(`${cmd} exit code ${code}: ${stderr}`));
    });
    proc.on("error", reject);
  });
}
