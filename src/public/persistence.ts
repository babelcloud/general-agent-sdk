import type { OpenClawSessionIdentity } from "./types.js";

export interface OpenClawStoredSession {
  sessionId: string;
  sessionKey: string;
  usageSnapshot?: {
    usedInputTokens: number;
    contextWindow: number;
    usedPct: number;
    capturedAtMs: number;
  };
  transcriptPath?: string | null;
}

export interface OpenClawSessionStoreAdapter {
  load(identity: OpenClawSessionIdentity): Promise<OpenClawStoredSession | null>;
  save(identity: OpenClawSessionIdentity, value: OpenClawStoredSession): Promise<void>;
  resolveSessionFile(identity: OpenClawSessionIdentity): Promise<string>;
}
