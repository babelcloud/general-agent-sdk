import type {
  GeneralAgentSessionIdentity,
  GeneralAgentMcpServerConfig,
} from "./types.js";

export interface GeneralAgentStoredSession {
  sessionId: string;
  sessionKey: string;
  mode?: GeneralAgentSessionIdentity["mode"];
  systemPrompt?: string;
  modelRef?: string;
  authProfileId?: string;
  rawEventLogPath?: string;
  usageSnapshot?: {
    usedInputTokens: number;
    contextWindow: number;
    usedPct: number;
    capturedAtMs: number;
  };
  transcriptPath?: string | null;
  dynamicMcpServers?: Record<string, GeneralAgentMcpServerConfig>;
  disabledMcpServers?: string[];
  createdAtMs?: number;
  updatedAtMs?: number;
  forkedFromSessionId?: string;
  pendingHostedTool?: {
    callId: string;
    toolName: string;
    input: Record<string, unknown>;
  } | null;
  pendingContinuation?: {
    strategy: "agent_loop_continue_single_tool" | "agent_loop_continue_multi_tool";
    runId: string;
    resolvedModelRef: string;
    systemPrompt: string;
    messages: unknown[];
    toolStartedAtMs?: number;
    hookState: {
      provider: string;
      model: string;
      prompt: string;
      systemPrompt?: string;
      imagesCount: number;
      startedAtMs: number;
      assistantTexts: string[];
      lastAssistant?: unknown;
    };
  } | null;
}

export interface GeneralAgentSessionStoreAdapter {
  load(identity: GeneralAgentSessionIdentity): Promise<GeneralAgentStoredSession | null>;
  save(identity: GeneralAgentSessionIdentity, value: GeneralAgentStoredSession): Promise<void>;
  resolveSessionFile(identity: GeneralAgentSessionIdentity): Promise<string>;
}
