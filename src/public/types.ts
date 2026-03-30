export interface GeneralAgentLogEvent {
  category:
    | "system_prompt"
    | "tool_call"
    | "tool_result"
    | "assistant"
    | "system"
    | "provider_debug";
  message: string;
  data?: Record<string, unknown>;
}

export interface GeneralAgentHostLogger {
  onDebug(event: GeneralAgentLogEvent): void;
  onInfo(event: GeneralAgentLogEvent): void;
  onWarn(event: GeneralAgentLogEvent): void;
  onError(event: GeneralAgentLogEvent): void;
  onRawStreamEvent?(event: Record<string, unknown>): void;
}

export interface GeneralAgentSessionIdentity {
  mode: "general" | "coding";
  sessionId: string;
  sessionKey: string;
}

export interface GeneralAgentSessionParams {
  identity: GeneralAgentSessionIdentity;
  systemPrompt: string;
  modelRef: string;
  sessionFile: string;
  authProfileId?: string;
  rawEventLogPath?: string;
  anthropicApiKey?: string;
}

export interface GeneralAgentTurnInput {
  role: "user";
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; mimeType: string; data: string }
    | { type: "tool_result"; callId: string; output: unknown; isError?: boolean }
  >;
}

export interface GeneralAgentUsageSnapshot {
  usedInputTokens: number;
  contextWindow: number;
  usedPct: number;
  capturedAtMs: number;
}

export interface GeneralAgentCompactionOptions {
  usedPctThreshold?: number;
  cooldownMs?: number;
}

export interface GeneralAgentCurrentQueryLike {
  mcpServerStatus?(): Promise<unknown>;
  toggleMcpServer?(serverName: string, enabled: boolean): Promise<void>;
}
