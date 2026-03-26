import type { OpenClawHostedToolDefinition } from "./host-tools.js";
import type { OpenClawSessionStoreAdapter } from "./persistence.js";
import type { OpenClawAgentSession } from "./session.js";
import type { OpenClawHostLogger, OpenClawSessionParams } from "./types.js";

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
}

export interface OpenClawAgentSdk {
  createSession(params: OpenClawSessionParams): OpenClawAgentSession;
  shutdown(): Promise<void>;
}

export async function createOpenClawAgentSdk(
  _options: OpenClawAgentSdkOptions,
): Promise<OpenClawAgentSdk> {
  throw new Error("OpenClaw Agent SDK bootstrap is not implemented yet");
}
