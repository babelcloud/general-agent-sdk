import type { GeneralAgentSessionIdentity } from "./types.js";

export interface GeneralAgentStoredSession {
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

export interface GeneralAgentSessionStoreAdapter {
  load(identity: GeneralAgentSessionIdentity): Promise<GeneralAgentStoredSession | null>;
  save(identity: GeneralAgentSessionIdentity, value: GeneralAgentStoredSession): Promise<void>;
  resolveSessionFile(identity: GeneralAgentSessionIdentity): Promise<string>;
}
