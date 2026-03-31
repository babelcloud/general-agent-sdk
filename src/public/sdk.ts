import type {
  GeneralAgentHookDispatchRequest,
  GeneralAgentHookDispatchResult,
  GeneralAgentHookName,
  GeneralAgentHookRegistration,
  GeneralAgentTranscriptEntry,
} from "./hooks.js";
import type { GeneralAgentHostedToolDefinition } from "./host-tools.js";
import type { GeneralAgentSessionStoreAdapter } from "./persistence.js";
import type { GeneralAgentSession } from "./session.js";
import type {
  GeneralAgentContinueSessionParams,
  GeneralAgentForkSessionParams,
  GeneralAgentHostLogger,
  GeneralAgentResumeSessionParams,
  GeneralAgentSessionIdentity,
  GeneralAgentSessionParams,
  GeneralAgentStoredSessionSummary,
} from "./types.js";
import { createSdkFactory } from "../core/embedded-runner/sdk-factory.js";

export interface GeneralAgentWebFetchToolOptions {
  cacheTtlMinutes?: number;
  timeoutSeconds?: number;
  maxCharsCap?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
  readability?: boolean;
  firecrawl?: {
    enabled?: boolean;
    apiKey?: string;
    baseUrl?: string;
    onlyMainContent?: boolean;
    maxAgeMs?: number;
    timeoutSeconds?: number;
  };
}

export interface GeneralAgentWebSearchToolOptions {
  apiKey?: string;
}

export interface GeneralAgentSdkToolOptions {
  web?: {
    fetch?: GeneralAgentWebFetchToolOptions;
    search?: GeneralAgentWebSearchToolOptions;
  };
}

export interface GeneralAgentSdkOptions {
  workspaceDir: string;
  stateDir: string;
  agentDir: string;
  profileId: string;
  pluginMode: "disabled" | "allowlisted" | "full-embedded";
  enabledPluginIds?: string[];
  logger: GeneralAgentHostLogger;
  sessionStore: GeneralAgentSessionStoreAdapter;
  hostedTools?: GeneralAgentHostedToolDefinition[];
  hooks?: GeneralAgentHookRegistration[];
  env?: Record<string, string | undefined>;
  tools?: GeneralAgentSdkToolOptions;
  anthropicApiKey?: string;
}

export interface GeneralAgentSdk {
  createSession(params: GeneralAgentSessionParams): GeneralAgentSession;
  continueSession(params: GeneralAgentContinueSessionParams): Promise<GeneralAgentSession>;
  resumeSession(
    sessionId: string,
    overrides?: GeneralAgentResumeSessionParams,
  ): Promise<GeneralAgentSession>;
  forkSession(
    sourceSessionId: string,
    params: GeneralAgentForkSessionParams,
  ): Promise<GeneralAgentSession>;
  listSessions(): Promise<GeneralAgentStoredSessionSummary[]>;
  readSessionHistory(sessionId: string): Promise<GeneralAgentTranscriptEntry[]>;
  emitHook<TName extends GeneralAgentHookName>(
    request: GeneralAgentHookDispatchRequest<TName>,
  ): Promise<GeneralAgentHookDispatchResult<TName> | undefined>;
  shutdown(): Promise<void>;
}

export async function createGeneralAgentSdk(
  options: GeneralAgentSdkOptions,
): Promise<GeneralAgentSdk> {
  return createSdkFactory(options);
}
