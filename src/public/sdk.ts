import type { OpenClawHostedToolDefinition } from "./host-tools.js";
import type { OpenClawSessionStoreAdapter } from "./persistence.js";
import type { OpenClawAgentSession } from "./session.js";
import type { OpenClawHostLogger, OpenClawSessionParams } from "./types.js";
import { createSdkFactory } from "../core/embedded-runner/sdk-factory.js";

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
  env?: Record<string, string | undefined>;
  anthropicApiKey?: string;
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
