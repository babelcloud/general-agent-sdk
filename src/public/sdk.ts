import type { OpenClawHostedToolDefinition } from "./host-tools.js";
import type { OpenClawSessionStoreAdapter } from "./persistence.js";
import type { OpenClawAgentSession } from "./session.js";
import type { OpenClawHostLogger, OpenClawSessionParams } from "./types.js";
import { createSdkFactory } from "../core/embedded-runner/sdk-factory.js";

export interface OpenClawProviderConfig {
  /** Provider type. Currently only "anthropic" is supported. */
  provider?: "anthropic";
  /** API key. Falls back to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
  /** Custom base URL for the API. */
  baseURL?: string;
}

export interface OpenClawAgentSdkOptions {
  workspaceDir: string;
  stateDir: string;
  agentDir: string;
  profileId: string;
  pluginMode: "disabled" | "allowlisted" | "full-embedded";
  enabledPluginIds?: string[];
  logger: OpenClawHostLogger;
  sessionStore: OpenClawSessionStoreAdapter;
  hostedTools?: OpenClawHostedToolDefinition[];
  /** LLM provider configuration. Required for real agent execution. */
  providerConfig?: OpenClawProviderConfig;
  /**
   * Built-in tool names to enable. Defaults to all 21 tools:
   * read, write, edit, exec, glob, grep, process,
   * web_search, web_fetch, browser, canvas, message,
   * agents_list, sessions_list, sessions_history, sessions_send,
   * sessions_spawn, sessions_yield, subagents, session_status,
   * memory_get, memory_search, tts.
   */
  builtinTools?: string[];
  /** Maximum agentic turns per streamTurn() call before forcing end_turn. Defaults to 50. */
  maxTurns?: number;
  env?: Record<string, string | undefined>;
}

export interface OpenClawAgentSdk {
  createSession(params: OpenClawSessionParams): OpenClawAgentSession;
  shutdown(): Promise<void>;
}

export async function createOpenClawAgentSdk(
  options: OpenClawAgentSdkOptions,
): Promise<OpenClawAgentSdk> {
  return createSdkFactory(options);
}
