import fs from "node:fs/promises";
import path from "node:path";
import type { GeneralAgentTranscriptEntry } from "../../public/hooks.js";
import type { GeneralAgentStoredSession } from "../../public/persistence.js";
import type { GeneralAgentStoredSessionSummary } from "../../public/types.js";

type SessionMetadataIndexFile = {
  sessions: Record<string, GeneralAgentStoredSession>;
};

const EMPTY_INDEX: SessionMetadataIndexFile = {
  sessions: {},
};

export class GeneralAgentSessionMetadataIndex {
  private readonly indexPath: string;

  constructor(stateDir: string) {
    this.indexPath = path.join(stateDir, "sessions", "index.json");
  }

  async get(sessionId: string): Promise<GeneralAgentStoredSession | null> {
    const index = await this.readIndex();
    return structuredClone(index.sessions[sessionId] ?? null);
  }

  async upsert(session: GeneralAgentStoredSession): Promise<void> {
    const index = await this.readIndex();
    index.sessions[session.sessionId] = structuredClone(session);
    await this.writeIndex(index);
  }

  async list(): Promise<GeneralAgentStoredSessionSummary[]> {
    const index = await this.readIndex();
    return Object.values(index.sessions)
      .map(toSessionSummary)
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
  }

  async readHistory(sessionId: string): Promise<GeneralAgentTranscriptEntry[]> {
    const session = await this.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return readTranscriptHistory(session.transcriptPath);
  }

  private async readIndex(): Promise<SessionMetadataIndexFile> {
    try {
      const raw = await fs.readFile(this.indexPath, "utf8");
      if (!raw.trim()) {
        return structuredClone(EMPTY_INDEX);
      }
      const parsed = JSON.parse(raw) as SessionMetadataIndexFile;
      return {
        sessions: parsed.sessions ?? {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return structuredClone(EMPTY_INDEX);
      }
      if (error instanceof SyntaxError) {
        // Corrupted index file (e.g., interrupted write). Start fresh rather than crash.
        return structuredClone(EMPTY_INDEX);
      }
      throw error;
    }
  }

  private async writeIndex(index: SessionMetadataIndexFile): Promise<void> {
    await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
    const next = JSON.stringify(index, null, 2);
    await fs.writeFile(this.indexPath, next, "utf8");
  }
}

export async function readTranscriptHistory(
  transcriptPath: string | null | undefined,
): Promise<GeneralAgentTranscriptEntry[]> {
  if (!transcriptPath) {
    return [];
  }

  try {
    const raw = await fs.readFile(transcriptPath, "utf8");
    const entries: GeneralAgentTranscriptEntry[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        entries.push(JSON.parse(trimmed) as GeneralAgentTranscriptEntry);
      } catch {
        // Skip malformed transcript lines (e.g., interrupted writes) rather than losing the entire history.
      }
    }
    return entries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function toSessionSummary(session: GeneralAgentStoredSession): GeneralAgentStoredSessionSummary {
  return {
    sessionId: session.sessionId,
    sessionKey: session.sessionKey,
    mode: session.mode ?? "general",
    modelRef: session.modelRef ?? "unknown",
    systemPrompt: session.systemPrompt ?? "",
    transcriptPath: session.transcriptPath,
    createdAtMs: session.createdAtMs ?? 0,
    updatedAtMs: session.updatedAtMs ?? 0,
    forkedFromSessionId: session.forkedFromSessionId,
  };
}
