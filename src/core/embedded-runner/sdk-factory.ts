import fs from "node:fs";
import path from "node:path";
import type { OpenClawAgentSdkOptions, OpenClawAgentSdk } from "../../public/sdk.js";
import type { OpenClawSessionParams } from "../../public/types.js";
import { OpenClawSdkSession } from "./sdk-session.js";

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function createSdkFactory(options: OpenClawAgentSdkOptions): OpenClawAgentSdk {
  ensureDir(options.workspaceDir);
  ensureDir(options.stateDir);
  ensureDir(options.agentDir);
  ensureDir(path.join(options.stateDir, "sessions"));

  const sessions = new Map<string, OpenClawSdkSession>();

  return {
    createSession(params: OpenClawSessionParams) {
      const existing = sessions.get(params.identity.sessionKey);
      if (existing) {
        existing.reconfigure(params);
        return existing;
      }

      const session = new OpenClawSdkSession(options, params);
      sessions.set(params.identity.sessionKey, session);
      return session;
    },
    async shutdown() {
      sessions.clear();
    },
  };
}
