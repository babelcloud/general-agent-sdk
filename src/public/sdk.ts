import type { GeneralAgentHostedToolDefinition } from "./host-tools.js";
import type { GeneralAgentSessionStoreAdapter } from "./persistence.js";
import type { GeneralAgentAgentSession } from "./session.js";
import type { GeneralAgentHostLogger, GeneralAgentSessionParams } from "./types.js";
import { createSdkFactory } from "../core/embedded-runner/sdk-factory.js";

export interface GeneralAgentAgentSdkOptions {
  workspaceDir: string;
  stateDir: string;
  agentDir: string;
  profileId: string;
  pluginMode: "disabled" | "allowlisted" | "full-embedded";
  enabledPluginIds?: string[];
  logger: GeneralAgentHostLogger;
  sessionStore: GeneralAgentSessionStoreAdapter;
  hostedTools?: GeneralAgentHostedToolDefinition[];
  env?: Record<string, string | undefined>;
  anthropicApiKey?: string;
}

export interface GeneralAgentAgentSdk {
  createSession(params: GeneralAgentSessionParams): GeneralAgentAgentSession;
  shutdown(): Promise<void>;
}

export async function createGeneralAgentAgentSdk(
  options: GeneralAgentAgentSdkOptions,
): Promise<GeneralAgentAgentSdk> {
  return createSdkFactory(options);
}
