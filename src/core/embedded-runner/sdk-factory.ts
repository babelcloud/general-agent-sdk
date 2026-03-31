import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { GeneralAgentSdkOptions, GeneralAgentSdk } from "../../public/sdk.js";
import type {
  GeneralAgentHookDispatchRequest,
  GeneralAgentHookDispatchResult,
  GeneralAgentHookName,
  GeneralAgentTranscriptEntry,
} from "../../public/hooks.js";
import type { GeneralAgentStoredSession } from "../../public/persistence.js";
import type {
  GeneralAgentContinueSessionParams,
  GeneralAgentForkSessionParams,
  GeneralAgentResumeSessionParams,
  GeneralAgentSessionIdentity,
  GeneralAgentSessionParams,
} from "../../public/types.js";
import { GeneralAgentSdkSession } from "./sdk-session.js";
import { initializeEmbeddedPlugins } from "../plugins/plugin-runtime.js";
import { GeneralAgentHookRunner } from "../plugins/sdk-hook-runner.js";
import {
  GeneralAgentSessionMetadataIndex,
  readTranscriptHistory,
} from "../sessions/session-metadata-index.js";
import { DEFAULT_MODEL_REF } from "../model/context-window.js";

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function createSdkFactory(options: GeneralAgentSdkOptions): GeneralAgentSdk {
  ensureDir(options.workspaceDir);
  ensureDir(options.stateDir);
  ensureDir(options.agentDir);
  ensureDir(path.join(options.stateDir, "sessions"));
  const pluginState = initializeEmbeddedPlugins(options);
  const metadataIndex = new GeneralAgentSessionMetadataIndex(options.stateDir);
  const hookRunner = new GeneralAgentHookRunner(options.hooks ?? [], options.logger);

  const sessions = new Map<string, GeneralAgentSdkSession>();

  function buildSdkSession(
    params: GeneralAgentSessionParams,
    existing?: GeneralAgentSdkSession,
  ): GeneralAgentSdkSession {
    if (existing) {
      existing.reconfigure(params);
      return existing;
    }

    const session = new GeneralAgentSdkSession(
      {
        ...options,
        pluginMode: pluginState.pluginMode,
        enabledPluginIds: pluginState.enabledPluginIds,
      },
      params,
    );
    sessions.set(params.identity.sessionId, session);
    return session;
  }

  return {
    createSession(params: GeneralAgentSessionParams) {
      const existing = sessions.get(params.identity.sessionId);
      return buildSdkSession(params, existing);
    },
    async continueSession(params: GeneralAgentContinueSessionParams) {
      const stored = await metadataIndex.get(params.identity.sessionId);
      if (!stored) {
        throw new Error(`Unknown session: ${params.identity.sessionId}`);
      }
      const sessionParams = await buildSessionParams({
        options,
        identity: params.identity,
        overrides: params,
        stored,
      });
      const existing = sessions.get(params.identity.sessionId);
      const session = buildSdkSession(sessionParams, existing);
      session.setResumeOriginSessionId(stored.sessionId);
      return session;
    },
    async resumeSession(sessionId: string, overrides: GeneralAgentResumeSessionParams = {}) {
      const stored = await metadataIndex.get(sessionId);
      if (!stored) {
        throw new Error(`Unknown session: ${sessionId}`);
      }
      const identity = getStoredIdentity(stored);
      const sessionParams = await buildSessionParams({
        options,
        identity,
        overrides,
        stored,
      });
      const existing = sessions.get(sessionId);
      const session = buildSdkSession(sessionParams, existing);
      session.setResumeOriginSessionId(stored.sessionId);
      return session;
    },
    async forkSession(sourceSessionId: string, params: GeneralAgentForkSessionParams) {
      const sourceSession = await metadataIndex.get(sourceSessionId);
      if (!sourceSession) {
        throw new Error(`Unknown session: ${sourceSessionId}`);
      }

      const transcriptPath =
        params.sessionFile ?? (await options.sessionStore.resolveSessionFile(params.identity));
      const sourceHistory = await readTranscriptHistory(sourceSession.transcriptPath);
      await writeTranscriptHistory(transcriptPath, sourceHistory);

      const now = Date.now();
      const storedFork: GeneralAgentStoredSession = {
        sessionId: params.identity.sessionId,
        sessionKey: params.identity.sessionKey,
        mode: params.identity.mode,
        systemPrompt: params.systemPrompt ?? sourceSession.systemPrompt ?? "",
        modelRef: params.modelRef ?? sourceSession.modelRef ?? DEFAULT_MODEL_REF,
        authProfileId: params.authProfileId ?? sourceSession.authProfileId,
        rawEventLogPath: params.rawEventLogPath ?? sourceSession.rawEventLogPath,
        usageSnapshot: sourceSession.usageSnapshot,
        transcriptPath,
        dynamicMcpServers: sourceSession.dynamicMcpServers,
        disabledMcpServers: sourceSession.disabledMcpServers,
        createdAtMs: now,
        updatedAtMs: now,
        forkedFromSessionId: sourceSessionId,
        pendingHostedTool: null,
      };

      await options.sessionStore.save(params.identity, storedFork);
      await metadataIndex.upsert(storedFork);

      const sessionParams = await buildSessionParams({
        options,
        identity: params.identity,
        overrides: params,
        stored: storedFork,
      });
      const session = buildSdkSession(sessionParams, sessions.get(params.identity.sessionId));
      session.setForkedFromSessionId(sourceSessionId);
      session.setResumeOriginSessionId(sourceSessionId);
      return session;
    },
    async listSessions() {
      return metadataIndex.list();
    },
    async readSessionHistory(sessionId: string): Promise<GeneralAgentTranscriptEntry[]> {
      return metadataIndex.readHistory(sessionId);
    },
    async emitHook<TName extends GeneralAgentHookName>(
      request: GeneralAgentHookDispatchRequest<TName>,
    ): Promise<GeneralAgentHookDispatchResult<TName> | undefined> {
      return hookRunner.emitHook(request);
    },
    async shutdown() {
      for (const session of sessions.values()) {
        await session.shutdown();
      }
      sessions.clear();
    },
  };
}

async function buildSessionParams(params: {
  options: GeneralAgentSdkOptions;
  identity: GeneralAgentSessionIdentity;
  overrides: GeneralAgentResumeSessionParams;
  stored: GeneralAgentStoredSession;
}): Promise<GeneralAgentSessionParams> {
  return {
    identity: params.identity,
    systemPrompt: params.overrides.systemPrompt ?? params.stored.systemPrompt ?? "",
    modelRef: params.overrides.modelRef ?? params.stored.modelRef ?? DEFAULT_MODEL_REF,
    sessionFile:
      params.overrides.sessionFile ??
      params.stored.transcriptPath ??
      (await params.options.sessionStore.resolveSessionFile(params.identity)),
    authProfileId: params.overrides.authProfileId ?? params.stored.authProfileId,
    rawEventLogPath: params.overrides.rawEventLogPath ?? params.stored.rawEventLogPath,
    anthropicApiKey: params.overrides.anthropicApiKey,
  };
}

function getStoredIdentity(stored: GeneralAgentStoredSession): GeneralAgentSessionIdentity {
  return {
    mode: stored.mode ?? "general",
    sessionId: stored.sessionId,
    sessionKey: stored.sessionKey,
  };
}

async function writeTranscriptHistory(
  transcriptPath: string,
  history: GeneralAgentTranscriptEntry[],
): Promise<void> {
  await fsp.mkdir(path.dirname(transcriptPath), { recursive: true });
  const serialized =
    history.length === 0
      ? ""
      : `${history.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  await fsp.writeFile(transcriptPath, serialized, "utf8");
}
