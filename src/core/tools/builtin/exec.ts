import { spawn } from "node:child_process";
import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MB

export const execTool: BuiltinTool = {
  definition: {
    name: "exec",
    description:
      "Execute shell commands with background continuation. " +
      "Use yieldMs/background to continue later via process tool. " +
      "Use pty=true for TTY-required commands (terminal UIs, coding agents).",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute.",
        },
        workdir: {
          type: "string",
          description: "Working directory (defaults to cwd).",
        },
        env: {
          type: "object",
          description: "Additional environment variables.",
        },
        yieldMs: {
          type: "number",
          description: "Milliseconds to wait before backgrounding (default 10000).",
        },
        background: {
          type: "boolean",
          description: "Run in background immediately.",
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds (optional, kills process on expiry).",
        },
        pty: {
          type: "boolean",
          description: "Run in a pseudo-terminal (PTY) when available (TTY-required CLIs, coding agents).",
        },
        elevated: {
          type: "boolean",
          description: "Run on the host with elevated permissions (if allowed).",
        },
        host: {
          type: "string",
          description: "Exec host (sandbox|gateway|node).",
        },
        security: {
          type: "string",
          description: "Exec security mode (deny|allowlist|full).",
        },
        ask: {
          type: "string",
          description: "Exec ask mode (off|on-miss|always).",
        },
        node: {
          type: "string",
          description: "Node id/name for host=node.",
        },
      },
      required: ["command"],
    },
  },

  async execute(input: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const command = input.command as string;
    const workdir = (input.workdir as string) || ctx.cwd;
    const extraEnv = (input.env as Record<string, string>) || {};
    // OpenClaw uses timeout in seconds; convert to ms for internal use
    const timeoutSec = typeof input.timeout === "number" ? input.timeout : 120;
    const timeoutMs = timeoutSec * 1000;

    // Background execution: delegate to process registry if available
    if (input.background === true || typeof input.yieldMs === "number") {
      try {
        const { spawnBackground } = await import("./process-registry.js");
        const entry = spawnBackground(command, workdir);
        const yieldMs = typeof input.yieldMs === "number" ? input.yieldMs : 0;
        if (yieldMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, yieldMs));
        }
        return {
          content: JSON.stringify({
            sessionId: entry.sessionId,
            pid: entry.pid,
            command: entry.command,
            status: entry.status,
            tail: (entry.stdout + entry.stderr).slice(-500),
          }),
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Error starting background process: ${msg}`, isError: true };
      }
    }

    try {
      const result = await runCommand(command, workdir, timeoutMs, extraEnv);
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

function runCommand(
  command: string,
  cwd: string,
  timeout: number,
  extraEnv: Record<string, string> = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("sh", ["-c", command], {
      cwd,
      timeout,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
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
