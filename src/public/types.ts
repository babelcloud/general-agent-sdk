export interface OpenClawLogEvent {
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

export interface OpenClawHostLogger {
  onDebug(event: OpenClawLogEvent): void;
  onInfo(event: OpenClawLogEvent): void;
  onWarn(event: OpenClawLogEvent): void;
  onError(event: OpenClawLogEvent): void;
  onRawStreamEvent?(event: Record<string, unknown>): void;
}

export interface OpenClawSessionIdentity {
  mode: "general" | "coding";
  sessionId: string;
  sessionKey: string;
}

export interface OpenClawSessionParams {
  identity: OpenClawSessionIdentity;
  systemPrompt: string;
  modelRef: string;
  sessionFile: string;
  authProfileId?: string;
  rawEventLogPath?: string;
}

export interface OpenClawTurnInput {
  role: "user";
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; mimeType: string; data: string }
    | { type: "tool_result"; callId: string; output: unknown; isError?: boolean }
  >;
}

export interface OpenClawUsageSnapshot {
  usedInputTokens: number;
  contextWindow: number;
  usedPct: number;
  capturedAtMs: number;
}

export interface OpenClawCompactionOptions {
  usedPctThreshold?: number;
  cooldownMs?: number;
}

export interface OpenClawCurrentQueryLike {
  mcpServerStatus?(): Promise<unknown>;
  toggleMcpServer?(serverName: string, enabled: boolean): Promise<void>;
}
