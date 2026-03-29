/**
 * Shared process registry for background exec sessions.
 * Used by both `exec` (to register background procs) and `process` (to manage them).
 */
import { spawn, type ChildProcess } from "node:child_process";

export interface BackgroundProcess {
  sessionId: string;
  pid: number;
  command: string;
  cwd: string;
  startedAt: number;
  status: "running" | "exited";
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  proc: ChildProcess;
}

const registry = new Map<string, BackgroundProcess>();
let nextId = 1;

export function spawnBackground(command: string, cwd: string): BackgroundProcess {
  const sessionId = `bg-${nextId++}-${Date.now()}`;
  const proc = spawn("sh", ["-c", command], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
    detached: false,
  });

  const entry: BackgroundProcess = {
    sessionId,
    pid: proc.pid ?? -1,
    command,
    cwd,
    startedAt: Date.now(),
    status: "running",
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: "",
    proc,
  };

  proc.stdout?.on("data", (chunk: Buffer) => {
    entry.stdout += chunk.toString();
    // Cap at 2MB
    if (entry.stdout.length > 2_000_000) {
      entry.stdout = entry.stdout.slice(-1_000_000);
    }
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    entry.stderr += chunk.toString();
    if (entry.stderr.length > 2_000_000) {
      entry.stderr = entry.stderr.slice(-1_000_000);
    }
  });

  proc.on("close", (code, signal) => {
    entry.status = "exited";
    entry.exitCode = code;
    entry.signal = signal;
  });

  proc.on("error", (err) => {
    entry.status = "exited";
    entry.exitCode = -1;
    entry.stderr += `\nProcess error: ${err.message}`;
  });

  registry.set(sessionId, entry);
  return entry;
}

export function listProcesses(): BackgroundProcess[] {
  return Array.from(registry.values());
}

export function getProcess(sessionId: string): BackgroundProcess | undefined {
  return registry.get(sessionId);
}

export function killProcess(sessionId: string): boolean {
  const entry = registry.get(sessionId);
  if (!entry || entry.status !== "running") return false;
  try {
    entry.proc.kill("SIGKILL");
    entry.status = "exited";
    entry.signal = "SIGKILL";
    return true;
  } catch {
    return false;
  }
}

export function removeProcess(sessionId: string): boolean {
  const entry = registry.get(sessionId);
  if (!entry) return false;
  if (entry.status === "running") {
    killProcess(sessionId);
  }
  return registry.delete(sessionId);
}

export function clearFinished(): number {
  let count = 0;
  for (const [id, entry] of registry) {
    if (entry.status === "exited") {
      registry.delete(id);
      count++;
    }
  }
  return count;
}
