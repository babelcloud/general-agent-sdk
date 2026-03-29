import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";
import {
  listProcesses,
  getProcess,
  killProcess,
  removeProcess,
  clearFinished,
  spawnBackground,
} from "./process-registry.js";

export const processTool: BuiltinTool = {
  definition: {
    name: "process",
    description:
      "Manage background exec sessions: list, poll, log, write, send-keys, kill, clear, remove.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description:
            "Process action: list, poll, log, write, send-keys, submit, paste, kill, clear, remove.",
        },
        sessionId: {
          type: "string",
          description: "Session id for actions other than list.",
        },
        command: {
          type: "string",
          description: "Shell command to start a new background process (action=start).",
        },
        data: {
          type: "string",
          description: "Data to write to stdin (action=write).",
        },
        text: {
          type: "string",
          description: "Text to paste (action=paste).",
        },
        eof: {
          type: "boolean",
          description: "Close stdin after write.",
        },
        offset: {
          type: "number",
          description: "Log offset (action=log).",
        },
        limit: {
          type: "number",
          description: "Log line limit (action=log).",
        },
        timeout: {
          type: "number",
          description: "For poll: wait up to this many milliseconds before returning.",
        },
      },
      required: ["action"],
    },
  },

  async execute(input: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const action = input.action as string;
    const sessionId = input.sessionId as string | undefined;

    switch (action) {
      case "start": {
        const command = input.command as string;
        if (!command) return { content: "Error: command is required for start.", isError: true };
        const entry = spawnBackground(command, ctx.cwd);
        return {
          content: JSON.stringify({
            sessionId: entry.sessionId,
            pid: entry.pid,
            command: entry.command,
            status: entry.status,
          }),
        };
      }

      case "list": {
        const procs = listProcesses().map((p) => ({
          sessionId: p.sessionId,
          pid: p.pid,
          command: p.command,
          status: p.status,
          startedAt: p.startedAt,
          runtimeMs: Date.now() - p.startedAt,
          exitCode: p.exitCode,
          signal: p.signal,
          tail: (p.stdout + p.stderr).slice(-500),
        }));
        return { content: JSON.stringify(procs, null, 2) };
      }

      case "poll": {
        if (!sessionId) return { content: "Error: sessionId is required.", isError: true };
        const entry = getProcess(sessionId);
        if (!entry) return { content: `Error: no session ${sessionId}.`, isError: true };
        const timeout = typeof input.timeout === "number" ? Math.min(input.timeout, 120_000) : 5000;

        if (entry.status === "running") {
          await new Promise((resolve) => setTimeout(resolve, timeout));
        }

        return {
          content: JSON.stringify({
            sessionId: entry.sessionId,
            status: entry.status,
            exitCode: entry.exitCode,
            signal: entry.signal,
            tail: (entry.stdout + entry.stderr).slice(-2000),
          }),
        };
      }

      case "log": {
        if (!sessionId) return { content: "Error: sessionId is required.", isError: true };
        const entry = getProcess(sessionId);
        if (!entry) return { content: `Error: no session ${sessionId}.`, isError: true };
        const combined = entry.stdout + entry.stderr;
        const lines = combined.split("\n");
        const offset = typeof input.offset === "number" ? input.offset : Math.max(0, lines.length - 200);
        const limit = typeof input.limit === "number" ? input.limit : 200;
        const selected = lines.slice(offset, offset + limit);
        return {
          content: JSON.stringify({
            sessionId: entry.sessionId,
            totalLines: lines.length,
            offset,
            lines: selected,
          }),
        };
      }

      case "write": {
        if (!sessionId) return { content: "Error: sessionId is required.", isError: true };
        const entry = getProcess(sessionId);
        if (!entry || entry.status !== "running")
          return { content: `Error: session ${sessionId} not running.`, isError: true };
        const data = (input.data as string) ?? "";
        try {
          entry.proc.stdin?.write(data);
          if (input.eof) entry.proc.stdin?.end();
          return { content: `Wrote ${data.length} bytes to ${sessionId}.` };
        } catch (err: unknown) {
          return { content: `Error writing to stdin: ${err instanceof Error ? err.message : err}`, isError: true };
        }
      }

      case "submit": {
        if (!sessionId) return { content: "Error: sessionId is required.", isError: true };
        const entry = getProcess(sessionId);
        if (!entry || entry.status !== "running")
          return { content: `Error: session ${sessionId} not running.`, isError: true };
        entry.proc.stdin?.write("\r");
        return { content: `Sent CR to ${sessionId}.` };
      }

      case "paste": {
        if (!sessionId) return { content: "Error: sessionId is required.", isError: true };
        const entry = getProcess(sessionId);
        if (!entry || entry.status !== "running")
          return { content: `Error: session ${sessionId} not running.`, isError: true };
        const text = (input.text as string) ?? "";
        entry.proc.stdin?.write(text);
        return { content: `Pasted ${text.length} chars to ${sessionId}.` };
      }

      case "send-keys": {
        if (!sessionId) return { content: "Error: sessionId is required.", isError: true };
        const entry = getProcess(sessionId);
        if (!entry || entry.status !== "running")
          return { content: `Error: session ${sessionId} not running.`, isError: true };
        const literal = input.literal as string | undefined;
        if (literal) entry.proc.stdin?.write(literal);
        return { content: `Sent keys to ${sessionId}.` };
      }

      case "kill": {
        if (!sessionId) return { content: "Error: sessionId is required.", isError: true };
        const ok = killProcess(sessionId);
        return ok
          ? { content: `Killed ${sessionId}.` }
          : { content: `Error: could not kill ${sessionId}.`, isError: true };
      }

      case "clear": {
        const count = clearFinished();
        return { content: `Cleared ${count} finished sessions.` };
      }

      case "remove": {
        if (!sessionId) return { content: "Error: sessionId is required.", isError: true };
        const ok = removeProcess(sessionId);
        return ok
          ? { content: `Removed ${sessionId}.` }
          : { content: `Error: no session ${sessionId}.`, isError: true };
      }

      default:
        return { content: `Unknown action: ${action}`, isError: true };
    }
  },
};
