import type { GeneralAgentTurnInput } from "./types.js";

type MaybePromise<T> = T | Promise<T>;

export type GeneralAgentHookContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface GeneralAgentToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: GeneralAgentHookContentBlock[];
  details?: unknown;
  isError: boolean;
  timestamp: number;
}

export type GeneralAgentTranscriptEntry =
  | { type: "system_prompt"; prompt: string; modelRef: string; timestamp: number }
  | { type: "message"; role: string; content: GeneralAgentTurnInput["content"]; timestamp: number }
  | {
      type: "tool_call";
      callId: string;
      toolName: string;
      input: Record<string, unknown>;
      timestamp: number;
    }
  | {
      type: "tool_result";
      callId: string;
      toolName: string;
      output: unknown;
      details?: unknown;
      isError?: boolean;
      timestamp: number;
    }
  | { type: "assistant"; text: string; timestamp: number };

export type GeneralAgentBeforeMessageWriteMessage =
  | GeneralAgentTranscriptEntry
  | GeneralAgentToolResultMessage;

export interface GeneralAgentAgentHookContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  messageProvider?: string;
  trigger?: string;
  channelId?: string;
}

export interface GeneralAgentBeforeModelResolveEvent {
  prompt: string;
}

export interface GeneralAgentBeforeModelResolveResult {
  modelOverride?: string;
  providerOverride?: string;
}

export interface GeneralAgentBeforePromptBuildEvent {
  prompt: string;
  messages: unknown[];
}

export interface GeneralAgentBeforePromptBuildResult {
  systemPrompt?: string;
  prependContext?: string;
  prependSystemContext?: string;
  appendSystemContext?: string;
}

export interface GeneralAgentBeforeAgentStartEvent {
  prompt: string;
  messages?: unknown[];
}

export type GeneralAgentBeforeAgentStartResult = GeneralAgentBeforePromptBuildResult &
  GeneralAgentBeforeModelResolveResult;

export interface GeneralAgentLlmInputEvent {
  runId: string;
  sessionId: string;
  provider: string;
  model: string;
  systemPrompt?: string;
  prompt: string;
  historyMessages: unknown[];
  imagesCount: number;
}

export interface GeneralAgentLlmOutputEvent {
  runId: string;
  sessionId: string;
  provider: string;
  model: string;
  assistantTexts: string[];
  lastAssistant?: unknown;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
}

export interface GeneralAgentAgentEndEvent {
  messages: unknown[];
  success: boolean;
  error?: string;
  durationMs?: number;
}

export interface GeneralAgentBeforeCompactionEvent {
  messageCount: number;
  compactingCount?: number;
  tokenCount?: number;
  messages?: unknown[];
  sessionFile?: string;
}

export interface GeneralAgentAfterCompactionEvent {
  messageCount: number;
  tokenCount?: number;
  compactedCount: number;
  sessionFile?: string;
}

export interface GeneralAgentBeforeResetEvent {
  sessionFile?: string;
  messages?: unknown[];
  reason?: string;
}

export interface GeneralAgentMessageHookContext {
  channelId: string;
  accountId?: string;
  conversationId?: string;
}

export interface GeneralAgentInboundClaimContext extends GeneralAgentMessageHookContext {
  parentConversationId?: string;
  senderId?: string;
  messageId?: string;
}

export interface GeneralAgentInboundClaimEvent {
  content: string;
  body?: string;
  bodyForAgent?: string;
  transcript?: string;
  timestamp?: number;
  channel: string;
  accountId?: string;
  conversationId?: string;
  parentConversationId?: string;
  senderId?: string;
  senderName?: string;
  senderUsername?: string;
  threadId?: string | number;
  messageId?: string;
  isGroup: boolean;
  commandAuthorized?: boolean;
  wasMentioned?: boolean;
  metadata?: Record<string, unknown>;
}

export interface GeneralAgentInboundClaimResult {
  handled: boolean;
}

export interface GeneralAgentBeforeDispatchEvent {
  content: string;
  body?: string;
  channel?: string;
  sessionKey?: string;
  senderId?: string;
  isGroup?: boolean;
  timestamp?: number;
}

export interface GeneralAgentBeforeDispatchContext {
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  sessionKey?: string;
  senderId?: string;
}

export interface GeneralAgentBeforeDispatchResult {
  handled: boolean;
  text?: string;
}

export interface GeneralAgentMessageReceivedEvent {
  from: string;
  content: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export interface GeneralAgentMessageSendingEvent {
  to: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface GeneralAgentMessageSendingResult {
  content?: string;
  cancel?: boolean;
}

export interface GeneralAgentMessageSentEvent {
  to: string;
  content: string;
  success: boolean;
  error?: string;
}

export interface GeneralAgentToolHookContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  toolName: string;
  toolCallId?: string;
}

export interface GeneralAgentBeforeToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
  runId?: string;
  toolCallId?: string;
}

export interface GeneralAgentBeforeToolCallResult {
  params?: Record<string, unknown>;
  block?: boolean;
  blockReason?: string;
}

export interface GeneralAgentAfterToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
  runId?: string;
  toolCallId?: string;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

export interface GeneralAgentToolResultPersistContext {
  agentId?: string;
  sessionKey?: string;
  toolName?: string;
  toolCallId?: string;
}

export interface GeneralAgentToolResultPersistEvent {
  toolName?: string;
  toolCallId?: string;
  message: GeneralAgentToolResultMessage;
  isSynthetic?: boolean;
}

export interface GeneralAgentToolResultPersistResult {
  message?: GeneralAgentToolResultMessage;
}

export interface GeneralAgentBeforeMessageWriteEvent {
  message: GeneralAgentBeforeMessageWriteMessage;
  sessionKey?: string;
  agentId?: string;
}

export interface GeneralAgentBeforeMessageWriteResult {
  block?: boolean;
  message?: GeneralAgentBeforeMessageWriteMessage;
}

export interface GeneralAgentSessionHookContext {
  agentId?: string;
  sessionId: string;
  sessionKey?: string;
}

export interface GeneralAgentSessionStartEvent {
  sessionId: string;
  sessionKey?: string;
  resumedFrom?: string;
}

export interface GeneralAgentSessionEndEvent {
  sessionId: string;
  sessionKey?: string;
  messageCount: number;
  durationMs?: number;
}

export interface GeneralAgentSubagentHookContext {
  runId?: string;
  childSessionKey?: string;
  requesterSessionKey?: string;
}

export type GeneralAgentSubagentTargetKind = "subagent" | "acp";

type GeneralAgentSubagentSpawnBase = {
  childSessionKey: string;
  agentId: string;
  label?: string;
  mode: "run" | "session";
  requester?: {
    channel?: string;
    accountId?: string;
    to?: string;
    threadId?: string | number;
  };
  threadRequested: boolean;
};

export type GeneralAgentSubagentSpawningEvent = GeneralAgentSubagentSpawnBase;

export type GeneralAgentSubagentSpawningResult =
  | {
      status: "ok";
      threadBindingReady?: boolean;
    }
  | {
      status: "error";
      error: string;
    };

export interface GeneralAgentSubagentDeliveryTargetEvent {
  childSessionKey: string;
  requesterSessionKey: string;
  requesterOrigin?: {
    channel?: string;
    accountId?: string;
    to?: string;
    threadId?: string | number;
  };
  childRunId?: string;
  spawnMode?: "run" | "session";
  expectsCompletionMessage: boolean;
}

export interface GeneralAgentSubagentDeliveryTargetResult {
  origin?: {
    channel?: string;
    accountId?: string;
    to?: string;
    threadId?: string | number;
  };
}

export type GeneralAgentSubagentSpawnedEvent = GeneralAgentSubagentSpawnBase & {
  runId: string;
};

export interface GeneralAgentSubagentEndedEvent {
  targetSessionKey: string;
  targetKind: GeneralAgentSubagentTargetKind;
  reason: string;
  sendFarewell?: boolean;
  accountId?: string;
  runId?: string;
  endedAt?: number;
  outcome?: "ok" | "error" | "timeout" | "killed" | "reset" | "deleted";
  error?: string;
}

export interface GeneralAgentGatewayHookContext {
  port?: number;
}

export interface GeneralAgentGatewayStartEvent {
  port: number;
}

export interface GeneralAgentGatewayStopEvent {
  reason?: string;
}

export interface GeneralAgentHookHandlerMap {
  before_model_resolve: (
    event: GeneralAgentBeforeModelResolveEvent,
    ctx: GeneralAgentAgentHookContext,
  ) => MaybePromise<GeneralAgentBeforeModelResolveResult | void>;
  before_prompt_build: (
    event: GeneralAgentBeforePromptBuildEvent,
    ctx: GeneralAgentAgentHookContext,
  ) => MaybePromise<GeneralAgentBeforePromptBuildResult | void>;
  before_agent_start: (
    event: GeneralAgentBeforeAgentStartEvent,
    ctx: GeneralAgentAgentHookContext,
  ) => MaybePromise<GeneralAgentBeforeAgentStartResult | void>;
  llm_input: (
    event: GeneralAgentLlmInputEvent,
    ctx: GeneralAgentAgentHookContext,
  ) => MaybePromise<void>;
  llm_output: (
    event: GeneralAgentLlmOutputEvent,
    ctx: GeneralAgentAgentHookContext,
  ) => MaybePromise<void>;
  agent_end: (
    event: GeneralAgentAgentEndEvent,
    ctx: GeneralAgentAgentHookContext,
  ) => MaybePromise<void>;
  before_compaction: (
    event: GeneralAgentBeforeCompactionEvent,
    ctx: GeneralAgentAgentHookContext,
  ) => MaybePromise<void>;
  after_compaction: (
    event: GeneralAgentAfterCompactionEvent,
    ctx: GeneralAgentAgentHookContext,
  ) => MaybePromise<void>;
  before_reset: (
    event: GeneralAgentBeforeResetEvent,
    ctx: GeneralAgentAgentHookContext,
  ) => MaybePromise<void>;
  inbound_claim: (
    event: GeneralAgentInboundClaimEvent,
    ctx: GeneralAgentInboundClaimContext,
  ) => MaybePromise<GeneralAgentInboundClaimResult | void>;
  message_received: (
    event: GeneralAgentMessageReceivedEvent,
    ctx: GeneralAgentMessageHookContext,
  ) => MaybePromise<void>;
  before_dispatch: (
    event: GeneralAgentBeforeDispatchEvent,
    ctx: GeneralAgentBeforeDispatchContext,
  ) => MaybePromise<GeneralAgentBeforeDispatchResult | void>;
  message_sending: (
    event: GeneralAgentMessageSendingEvent,
    ctx: GeneralAgentMessageHookContext,
  ) => MaybePromise<GeneralAgentMessageSendingResult | void>;
  message_sent: (
    event: GeneralAgentMessageSentEvent,
    ctx: GeneralAgentMessageHookContext,
  ) => MaybePromise<void>;
  before_tool_call: (
    event: GeneralAgentBeforeToolCallEvent,
    ctx: GeneralAgentToolHookContext,
  ) => MaybePromise<GeneralAgentBeforeToolCallResult | void>;
  after_tool_call: (
    event: GeneralAgentAfterToolCallEvent,
    ctx: GeneralAgentToolHookContext,
  ) => MaybePromise<void>;
  tool_result_persist: (
    event: GeneralAgentToolResultPersistEvent,
    ctx: GeneralAgentToolResultPersistContext,
  ) => GeneralAgentToolResultPersistResult | void;
  before_message_write: (
    event: GeneralAgentBeforeMessageWriteEvent,
    ctx: { agentId?: string; sessionKey?: string },
  ) => GeneralAgentBeforeMessageWriteResult | void;
  session_start: (
    event: GeneralAgentSessionStartEvent,
    ctx: GeneralAgentSessionHookContext,
  ) => MaybePromise<void>;
  session_end: (
    event: GeneralAgentSessionEndEvent,
    ctx: GeneralAgentSessionHookContext,
  ) => MaybePromise<void>;
  subagent_spawning: (
    event: GeneralAgentSubagentSpawningEvent,
    ctx: GeneralAgentSubagentHookContext,
  ) => MaybePromise<GeneralAgentSubagentSpawningResult | void>;
  subagent_delivery_target: (
    event: GeneralAgentSubagentDeliveryTargetEvent,
    ctx: GeneralAgentSubagentHookContext,
  ) => MaybePromise<GeneralAgentSubagentDeliveryTargetResult | void>;
  subagent_spawned: (
    event: GeneralAgentSubagentSpawnedEvent,
    ctx: GeneralAgentSubagentHookContext,
  ) => MaybePromise<void>;
  subagent_ended: (
    event: GeneralAgentSubagentEndedEvent,
    ctx: GeneralAgentSubagentHookContext,
  ) => MaybePromise<void>;
  gateway_start: (
    event: GeneralAgentGatewayStartEvent,
    ctx: GeneralAgentGatewayHookContext,
  ) => MaybePromise<void>;
  gateway_stop: (
    event: GeneralAgentGatewayStopEvent,
    ctx: GeneralAgentGatewayHookContext,
  ) => MaybePromise<void>;
}

export type GeneralAgentHookName = keyof GeneralAgentHookHandlerMap;

export type GeneralAgentHookEventMap = {
  [TName in GeneralAgentHookName]: Parameters<GeneralAgentHookHandlerMap[TName]>[0];
};

export type GeneralAgentHookContextMap = {
  [TName in GeneralAgentHookName]: Parameters<GeneralAgentHookHandlerMap[TName]>[1];
};

export type GeneralAgentHookResultMap = {
  [TName in GeneralAgentHookName]: Awaited<ReturnType<GeneralAgentHookHandlerMap[TName]>>;
};

type GeneralAgentHookRegistrationBase<TName extends GeneralAgentHookName> = {
  pluginId: string;
  priority?: number;
  hookName: TName;
  handler: GeneralAgentHookHandlerMap[TName];
};

export type GeneralAgentHookRegistration = {
  [TName in GeneralAgentHookName]: GeneralAgentHookRegistrationBase<TName>;
}[GeneralAgentHookName];

export type GeneralAgentHookDispatchRequest<TName extends GeneralAgentHookName> = {
  hookName: TName;
  event: GeneralAgentHookEventMap[TName];
  context: GeneralAgentHookContextMap[TName];
};

export type GeneralAgentHookDispatchResult<TName extends GeneralAgentHookName> =
  GeneralAgentHookResultMap[TName];
