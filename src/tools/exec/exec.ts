import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "child_process";
import { z } from "zod";
import type { GeneralAgentTool, GeneralAgentToolResult } from "../tool-interface.js";
import { textResult, failedTextResult } from "../shared/tool-result.js";
import { waitForChildProcess } from "../shared/child-process.js";
import { getShellConfig, getShellEnv, killProcessTree, sanitizeBinaryOutput } from "../shared/shell.js";
import { DEFAULT_MAX_LINES, truncateTail } from "../shared/truncate.js";
import { addSession, markExited, appendOutput, markBackgrounded, getSession } from "./process-registry.js";

function getTempFilePath(): string {
	const id = randomBytes(8).toString("hex");
	return join(tmpdir(), `openclaw-exec-${id}.log`);
}

const execSchema = z.object({
	command: z.string().describe("Shell command to execute"),
	workdir: z.string().optional().describe("Working directory (defaults to cwd)"),
	timeout: z.number().optional().describe("Timeout in seconds"),
	background: z.boolean().optional().describe("Run in background immediately"),
	yieldMs: z.number().optional().describe("Ms to wait before backgrounding (default 10000)"),
});

export interface ExecOperations {
	exec: (
		command: string,
		cwd: string,
		options: {
			onData: (data: Buffer) => void;
			signal?: AbortSignal;
			timeout?: number;
			env?: NodeJS.ProcessEnv;
		},
	) => Promise<{ exitCode: number | null }>;
}

export function createLocalExecOperations(): ExecOperations {
	return {
		exec: (command, cwd, { onData, signal, timeout, env }) => {
			return new Promise((resolve, reject) => {
				const { shell, args } = getShellConfig();
				if (!existsSync(cwd)) {
					reject(new Error(`Working directory does not exist: ${cwd}`));
					return;
				}
				const child = spawn(shell, [...args, command], {
					cwd,
					detached: true,
					env: env ?? getShellEnv(),
					stdio: ["ignore", "pipe", "pipe"],
				});
				let timedOut = false;
				let timeoutHandle: NodeJS.Timeout | undefined;
				if (timeout !== undefined && timeout > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						if (child.pid) killProcessTree(child.pid);
					}, timeout * 1000);
				}
				child.stdout?.on("data", onData);
				child.stderr?.on("data", onData);
				const onAbort = () => {
					if (child.pid) killProcessTree(child.pid);
				};
				if (signal) {
					if (signal.aborted) onAbort();
					else signal.addEventListener("abort", onAbort, { once: true });
				}
				waitForChildProcess(child)
					.then((code) => {
						if (timeoutHandle) clearTimeout(timeoutHandle);
						if (signal) signal.removeEventListener("abort", onAbort);
						if (signal?.aborted) {
							reject(new Error("aborted"));
							return;
						}
						if (timedOut) {
							reject(new Error(`timeout:${timeout}`));
							return;
						}
						resolve({ exitCode: code });
					})
					.catch((err: any) => {
						if (timeoutHandle) clearTimeout(timeoutHandle);
						if (signal) signal.removeEventListener("abort", onAbort);
						reject(err);
					});
			});
		},
	};
}

export function createExecTool(cwd: string, ops?: ExecOperations): GeneralAgentTool {
	const operations = ops ?? createLocalExecOperations();

	return {
		name: "exec",
		description: "Execute a shell command. Supports timeout, background execution, and working directory override.",
		parameters: execSchema,
		async execute(callId: string, params: unknown, signal?: AbortSignal): Promise<GeneralAgentToolResult> {
			const parsed = execSchema.parse(params);
			const { command, timeout, background, yieldMs = 10000 } = parsed;
			const workdir = parsed.workdir ?? cwd;

			// Background mode: start and return immediately
			if (background) {
				return startBackgroundExec(command, workdir, operations);
			}

			// Foreground mode: execute and collect output
			const chunks: string[] = [];
			let totalBytes = 0;

			try {
				const { exitCode } = await operations.exec(command, workdir, {
					onData: (data: Buffer) => {
						const text = sanitizeBinaryOutput(data.toString("utf-8"));
						chunks.push(text);
						totalBytes += data.length;
					},
					signal,
					timeout,
					env: getShellEnv(),
				});

				let output = chunks.join("");
				const truncated = truncateTail(output, { maxLines: DEFAULT_MAX_LINES });
				output = truncated.content;

				let result = output;
				if (truncated.truncated) {
					result += `\n[Output truncated: showing last ${truncated.outputLines} lines]`;
				}
				if (exitCode !== 0) {
					result += `\n[Exit code: ${exitCode}]`;
				}

				return textResult(result || "(no output)");
			} catch (err) {
				const errMsg = err instanceof Error ? err.message : String(err);
				if (errMsg.startsWith("timeout:")) {
					const output = chunks.join("");
					return textResult(`[Command timed out after ${timeout}s]\n${output}`);
				}
				if (errMsg === "aborted") {
					return failedTextResult("Command was aborted");
				}
				return failedTextResult(`Command failed: ${errMsg}`);
			}
		},
	};
}

function startBackgroundExec(
	command: string,
	cwd: string,
	operations: ExecOperations,
): GeneralAgentToolResult {
	const sessionId = randomBytes(6).toString("hex");
	const { shell, args } = getShellConfig();

	const child = spawn(shell, [...args, command], {
		cwd,
		detached: true,
		env: getShellEnv(),
		stdio: ["pipe", "pipe", "pipe"],
	});

	addSession({
		id: sessionId,
		command,
		pid: child.pid,
		startedAt: Date.now(),
		cwd,
		stdin: child.stdin,
		aggregated: "",
		tail: "",
		pendingOutput: "",
		backgrounded: true,
		exitCode: null,
		exitSignal: null,
		exitedAt: null,
		child,
	});

	child.stdout?.on("data", (data: Buffer) => {
		appendOutput(sessionId, data.toString("utf-8"));
	});
	child.stderr?.on("data", (data: Buffer) => {
		appendOutput(sessionId, data.toString("utf-8"));
	});

	child.on("exit", (code, signal) => {
		markExited(sessionId, code, signal?.toString() ?? null);
	});

	return textResult(
		`Background session started: ${sessionId}\nCommand: ${command}\nPID: ${child.pid}\nUse the process tool to check status.`,
	) as GeneralAgentToolResult;
}
