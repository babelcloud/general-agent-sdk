import { spawn } from "node:child_process";
import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MB

export const execTool: BuiltinTool = {
  definition: {
    name: "exec",
    description:
      "Execute a shell command and return its output. " +
      "Commands run in the workspace directory. " +
      "Timeout defaults to 120 seconds.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute.",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds. Defaults to 120000.",
        },
      },
      required: ["command"],
    },
  },

  async execute(input: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const command = input.command as string;
    const timeout = typeof input.timeout === "number" ? input.timeout : DEFAULT_TIMEOUT_MS;

    try {
      const result = await runCommand(command, ctx.cwd, timeout);
      const output = truncateOutput(result.stdout + result.stderr, MAX_OUTPUT_BYTES);
      if (result.exitCode !== 0) {
        return {
          content: `Exit code: ${result.exitCode}\n${output}`,
          isError: true,
        };
      }
      return { content: output || "(no output)" };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: `Error executing command: ${msg}`, isError: true };
    }
  },
};

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCommand(command: string, cwd: string, timeout: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("sh", ["-c", command], {
      cwd,
      timeout,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
    proc.on("error", reject);
  });
}

function truncateOutput(output: string, maxBytes: number): string {
  if (Buffer.byteLength(output) <= maxBytes) return output;
  const truncated = Buffer.from(output).subarray(0, maxBytes).toString();
  return truncated + "\n...(output truncated)";
}
