import type { ChildProcess } from "node:child_process";

export interface ProcessSession {
	id: string;
	command: string;
	pid: number | undefined;
	startedAt: number;
	cwd: string;
	stdin: NodeJS.WritableStream | null;
	aggregated: string;
	tail: string;
	pendingOutput: string;
	backgrounded: boolean;
	exitCode: number | null;
	exitSignal: string | null;
	exitedAt: number | null;
	child: ChildProcess;
}

const runningSessions = new Map<string, ProcessSession>();
const finishedSessions = new Map<string, ProcessSession>();

const MAX_TAIL_SIZE = 50_000;
const MAX_PENDING_SIZE = 100_000;

export function addSession(session: ProcessSession): void {
	runningSessions.set(session.id, session);
}

export function getSession(id: string): ProcessSession | undefined {
	return runningSessions.get(id);
}

export function getFinishedSession(id: string): ProcessSession | undefined {
	return finishedSessions.get(id);
}

export function appendOutput(id: string, chunk: string): void {
	const session = runningSessions.get(id) ?? finishedSessions.get(id);
	if (!session) return;

	session.aggregated += chunk;
	session.pendingOutput += chunk;

	// Keep tail bounded
	if (session.tail.length + chunk.length > MAX_TAIL_SIZE) {
		session.tail = (session.tail + chunk).slice(-MAX_TAIL_SIZE);
	} else {
		session.tail += chunk;
	}

	// Keep pending bounded
	if (session.pendingOutput.length > MAX_PENDING_SIZE) {
		session.pendingOutput = session.pendingOutput.slice(-MAX_PENDING_SIZE);
	}
}

export function drainPending(id: string): string {
	const session = runningSessions.get(id) ?? finishedSessions.get(id);
	if (!session) return "";
	const pending = session.pendingOutput;
	session.pendingOutput = "";
	return pending;
}

export function markBackgrounded(id: string): void {
	const session = runningSessions.get(id);
	if (session) {
		session.backgrounded = true;
	}
}

export function markExited(id: string, code: number | null, signal: string | null): void {
	const session = runningSessions.get(id);
	if (!session) return;
	session.exitCode = code;
	session.exitSignal = signal;
	session.exitedAt = Date.now();
	runningSessions.delete(id);
	finishedSessions.set(id, session);
}

export function deleteSession(id: string): void {
	runningSessions.delete(id);
	finishedSessions.delete(id);
}

export function listSessions(): ProcessSession[] {
	return [
		...Array.from(runningSessions.values()),
		...Array.from(finishedSessions.values()),
	];
}
