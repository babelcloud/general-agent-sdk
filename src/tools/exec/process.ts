import { z } from "zod";
import type { GeneralAgentTool, GeneralAgentToolResult } from "../tool-interface.js";
import { textResult, jsonResult, failedTextResult } from "../shared/tool-result.js";
import { killProcessTree } from "../shared/shell.js";
import {
	getSession,
	getFinishedSession,
	drainPending,
	listSessions,
	deleteSession,
} from "./process-registry.js";

const processSchema = z.object({
	action: z.string().describe("Action: list, poll, log, write, kill, remove"),
	sessionId: z.string().optional().describe("Session id (required except for list)"),
	data: z.string().optional().describe("Data to write to stdin"),
	offset: z.number().optional().describe("Log offset"),
	limit: z.number().optional().describe("Log length"),
	timeout: z.number().optional().describe("Poll wait timeout in ms (max 120000)"),
});

export function createProcessTool(): GeneralAgentTool {
	return {
		name: "process",
		description: "Manage running exec sessions: list, poll, log, write, kill, remove.",
		parameters: processSchema,
		async execute(callId: string, params: unknown): Promise<GeneralAgentToolResult> {
			const parsed = processSchema.parse(params);
			const { action, sessionId } = parsed;

			if (action === "list") {
				const sessions = listSessions();
				if (sessions.length === 0) {
					return textResult("No active sessions.");
				}
				const summary = sessions.map((s) => ({
					id: s.id,
					command: s.command.substring(0, 80),
					pid: s.pid,
					running: s.exitCode === null && s.exitedAt === null,
					exitCode: s.exitCode,
					startedAt: new Date(s.startedAt).toISOString(),
				}));
				return jsonResult(summary);
			}

			if (!sessionId) {
				return failedTextResult("sessionId is required for this action");
			}

			const session = getSession(sessionId) ?? getFinishedSession(sessionId);
			if (!session) {
				return failedTextResult(`Session not found: ${sessionId}`);
			}

			switch (action) {
				case "poll": {
					const pending = drainPending(sessionId);
					const isRunning = session.exitCode === null && session.exitedAt === null;
					return textResult(
						`${isRunning ? "[running]" : `[exited: ${session.exitCode}]`}\n${pending || "(no new output)"}`,
					);
				}

				case "log": {
					const offset = parsed.offset ?? 0;
					const limit = parsed.limit ?? 2000;
					const lines = session.aggregated.split("\n");
					const slice = lines.slice(offset, offset + limit);
					return textResult(
						`[Lines ${offset}-${offset + slice.length} of ${lines.length}]\n${slice.join("\n")}`,
					);
				}

				case "write": {
					if (!parsed.data) {
						return failedTextResult("data is required for write action");
					}
					if (!session.stdin || session.exitedAt !== null) {
						return failedTextResult("Session stdin is not available or session has exited");
					}
					session.stdin.write(parsed.data);
					return textResult("Data written to stdin.");
				}

				case "kill": {
					if (session.pid && session.exitedAt === null) {
						killProcessTree(session.pid);
						return textResult(`Sent SIGKILL to process tree (PID: ${session.pid})`);
					}
					return textResult("Session already exited.");
				}

				case "remove": {
					deleteSession(sessionId);
					return textResult(`Session ${sessionId} removed.`);
				}

				default:
					return failedTextResult(`Unknown action: ${action}. Use: list, poll, log, write, kill, remove`);
			}
		},
	};
}
