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

export interface GeneralAgentResumeSessionParams {
  sessionFile?: string;
  authProfileId?: string;
  rawEventLogPath?: string;
  anthropicApiKey?: string;
  systemPrompt?: string;
  modelRef?: string;
}

export interface GeneralAgentContinueSessionParams extends GeneralAgentResumeSessionParams {
  identity: GeneralAgentSessionIdentity;
}

export interface GeneralAgentForkSessionParams extends GeneralAgentResumeSessionParams {
  identity: GeneralAgentSessionIdentity;
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
  mcpServerStatus?(): Promise<GeneralAgentMcpServerStatus[]>;
  toggleMcpServer?(serverName: string, enabled: boolean): Promise<void>;
}

export interface GeneralAgentMcpStdioServerConfig {
  transport: "stdio";
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface GeneralAgentMcpHttpServerConfig {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

export type GeneralAgentMcpServerConfig =
  | GeneralAgentMcpStdioServerConfig
  | GeneralAgentMcpHttpServerConfig;

export interface GeneralAgentMcpServerStatus {
  serverName: string;
  transport: GeneralAgentMcpServerConfig["transport"];
  enabled: boolean;
  supported: boolean;
  error?: string;
}

export interface GeneralAgentFileCheckpointFile {
  path: string;
  existedBefore: boolean;
}

export interface GeneralAgentFileCheckpoint {
  id: string;
  toolName: string;
  callId: string;
  createdAtMs: number;
  files: GeneralAgentFileCheckpointFile[];
}

export interface GeneralAgentStoredSessionSummary {
  sessionId: string;
  sessionKey: string;
  mode: GeneralAgentSessionIdentity["mode"];
  modelRef: string;
  systemPrompt: string;
  transcriptPath?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  forkedFromSessionId?: string;
}
