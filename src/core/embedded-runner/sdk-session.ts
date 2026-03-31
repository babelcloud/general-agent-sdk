import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { GeneralAgentStreamEvent } from "../../public/events.js";
import type {
  GeneralAgentAgentHookContext,
  GeneralAgentBeforeAgentStartResult,
  GeneralAgentBeforeMessageWriteMessage,
  GeneralAgentBeforeModelResolveResult,
  GeneralAgentBeforePromptBuildResult,
  GeneralAgentToolResultMessage,
  GeneralAgentToolHookContext,
  GeneralAgentTranscriptEntry,
} from "../../public/hooks.js";
import type {
  GeneralAgentHostedToolDefinition,
  GeneralAgentHostedToolErrorInput,
  GeneralAgentHostedToolResultInput,
} from "../../public/host-tools.js";
import type { GeneralAgentSessionStoreAdapter } from "../../public/persistence.js";
import type { GeneralAgentSdkOptions } from "../../public/sdk.js";
import type { GeneralAgentSession } from "../../public/session.js";
import type {
  GeneralAgentCompactionOptions,
  GeneralAgentCurrentQueryLike,
  GeneralAgentFileCheckpoint,
  GeneralAgentMcpServerConfig,
  GeneralAgentMcpServerStatus,
  GeneralAgentSessionParams,
  GeneralAgentTurnInput,
  GeneralAgentUsageSnapshot,
} from "../../public/types.js";
import {
  createAssistantCompletionEvents,
  createHostedToolSuspendEvents,
  createStopEvents,
} from "../normalization/upstream-events.js";
import { HostLoggerSink } from "../logging/host-logger.js";
import { resolveHostSessionFile } from "../sessions/session-store.js";
import {
  GeneralAgentSessionMetadataIndex,
  readTranscriptHistory,
} from "../sessions/session-metadata-index.js";
import { isToolAllowedInEmbeddedMode } from "../tools/tool-policy.js";
import { assembleLocalTools } from "../../tools/tool-assembly.js";
import type { SubagentRunParams, SubagentRunResult } from "../../tools/subagent/subagent-tool.js";
import type { GeneralAgentTool, GeneralAgentToolResult } from "../../tools/tool-interface.js";
import type {
  AgentContext,
  AgentTool,
  AgentEvent,
  AgentMessage,
  AgentToolResult,
} from "../../loop/agent-types.js";
import { agentLoop, agentLoopContinue } from "../../loop/agent-loop.js";
import type {
  AssistantMessage,
  Message,
  ToolResultMessage,
  UserMessage,
} from "../../providers/anthropic-types.js";
import { adaptAgentEventToStreamEvents } from "./agent-event-adapter.js";
import { HostedToolBridge } from "./hosted-tool-bridge.js";
import { modelFromRef } from "./model-from-ref.js";
import { resolveContextWindow } from "../model/context-window.js";
import { GeneralAgentHookRunner } from "../plugins/sdk-hook-runner.js";
import {
  GeneralAgentFileCheckpointManager,
  type CapturedFileCheckpoint,
  type FileCheckpointTarget,
} from "../checkpoints/file-checkpoint-manager.js";
import { resolveToCwd } from "../../tools/shared/path-utils.js";
import { resolveApplyPatchTargets } from "../../tools/file/apply-patch.js";
import { createDynamicMcpToolRuntime } from "../mcp/runtime.js";
import { compactMessages } from "../compaction/compact.js";
import { sanitizeMessages } from "../sessions/transcript-repair.js";

type PendingHostedToolCall = {
  callId: string;
  toolName: string;
  input: Record<string, unknown>;
};

type ActiveVendoredRun = {
  iterator: AsyncIterator<AgentEvent>;
  context: AgentContext;
  pendingNext: Promise<IteratorResult<AgentEvent>> | null;
  dispose?: () => Promise<void>;
  resolvedModelRef?: string;
  hookState?: {
    provider: string;
    model: string;
    prompt: string;
    systemPrompt?: string;
    imagesCount: number;
    startedAt: number;
    assistantTexts: string[];
    lastAssistant?: AssistantMessage;
    messagePrefix?: AgentMessage[];
  };
};

type PendingHostedToolContinuation = {
  strategy: "agent_loop_continue_single_tool" | "agent_loop_continue_multi_tool";
  runId: string;
  resolvedModelRef: string;
  systemPrompt: string;
  messages: AgentMessage[];
  toolStartedAtMs?: number;
  hookState: {
    provider: string;
    model: string;
    prompt: string;
    systemPrompt?: string;
    imagesCount: number;
    startedAtMs: number;
    assistantTexts: string[];
    lastAssistant?: AssistantMessage;
  };
};

type TranscriptEntry = GeneralAgentTranscriptEntry;

function createFallbackAssistantMessage(text: string) {
  return {
    role: "assistant" as const,
    content: text ? [{ type: "text" as const, text }] : [],
    api: "anthropic-messages" as const,
    provider: "anthropic",
    model: "fallback-hosted-tool",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };
}

export class GeneralAgentSdkSession implements GeneralAgentSession {
  private params: GeneralAgentSessionParams;
  private readonly sessionStore: GeneralAgentSessionStoreAdapter;
  private readonly hostedTools: GeneralAgentHostedToolDefinition[];
  private readonly restorePromise: Promise<void>;
  private readonly dynamicMcpServers: Record<string, GeneralAgentMcpServerConfig> = {};
  private readonly disabledMcpServers = new Set<string>();
  private pendingDynamicMcpServerOverride: Record<string, GeneralAgentMcpServerConfig> | null = null;
  private restoreCompleted = false;
  private createdAtMs = Date.now();
  private forkedFromSessionId: string | undefined;
  private usageSnapshot: GeneralAgentUsageSnapshot | null = null;
  private transcriptPath: string | null;
  private pendingHostedTool: PendingHostedToolCall | null = null;
  private pendingHostedToolContinuation: PendingHostedToolContinuation | null = null;
  private stopRequested = false;
  private abortController: AbortController | null = null;
  private currentQuery: GeneralAgentCurrentQueryLike | null = null;
  private lastCompactionAt = 0;
  private loggerSink: HostLoggerSink;
  private readonly localTools: GeneralAgentTool[];
  private readonly checkpointManager = new GeneralAgentFileCheckpointManager();
  private readonly metadataIndex: GeneralAgentSessionMetadataIndex;
  private readonly hostedToolBridge = new HostedToolBridge();
  private readonly hookRunner: GeneralAgentHookRunner;
  // Persistent agent context across turns (for the vendored loop)
  private agentMessages: AgentMessage[] = [];
  private activeVendoredRun: ActiveVendoredRun | null = null;
  private currentRunId: string | null = null;
  private readonly toolCallStartedAt = new Map<string, number>();
  private sessionStartHookEmitted = false;
  private sessionStartedAtMs: number | null = null;
  private resumeOriginSessionId: string | undefined;
  private pendingCompactionEvents: GeneralAgentStreamEvent[] = [];

  constructor(
    private readonly options: GeneralAgentSdkOptions,
    params: GeneralAgentSessionParams,
  ) {
    this.params = params;
    this.sessionStore = options.sessionStore;
    this.hostedTools = options.hostedTools ?? [];
    this.transcriptPath = params.sessionFile;
    this.loggerSink = new HostLoggerSink(options.logger, params.rawEventLogPath);
    this.metadataIndex = new GeneralAgentSessionMetadataIndex(options.stateDir);
    this.restorePromise = this.restoreStoredState();
    const assembledTools = assembleLocalTools(options.workspaceDir, {
      env: options.env,
      web: options.tools?.web,
      subagentContext: {
        runChildSession: (childParams) => this.runChildSession(childParams),
      },
    });
    this.localTools = assembledTools.map((tool) => this.wrapToolWithCheckpointing(tool));
    this.hookRunner = new GeneralAgentHookRunner(options.hooks ?? [], options.logger);
    this.currentQuery = {
      mcpServerStatus: () => this.getMcpServerStatus(),
      toggleMcpServer: (serverName, enabled) => this.toggleMcpServer(serverName, enabled),
    };
  }

  reconfigure(params: GeneralAgentSessionParams): void {
    this.params = params;
    this.transcriptPath = params.sessionFile;
    this.loggerSink = new HostLoggerSink(this.options.logger, params.rawEventLogPath);
  }

  setForkedFromSessionId(sourceSessionId: string | undefined): void {
    this.forkedFromSessionId = sourceSessionId;
  }

  setResumeOriginSessionId(sourceSessionId: string | undefined): void {
    this.resumeOriginSessionId = sourceSessionId;
  }

  async shutdown(): Promise<void> {
    await this.restorePromise;
    if (!this.sessionStartHookEmitted) {
      return;
    }

    const history = await readTranscriptHistory(this.transcriptPath);
    await this.hookRunner.runSessionEnd(
      {
        sessionId: this.params.identity.sessionId,
        sessionKey: this.params.identity.sessionKey,
        messageCount: history.length,
        durationMs:
          this.sessionStartedAtMs != null ? Date.now() - this.sessionStartedAtMs : undefined,
      },
      {
        agentId: inferAgentIdFromSessionKey(this.params.identity.sessionKey),
        sessionId: this.params.identity.sessionId,
        sessionKey: this.params.identity.sessionKey,
      },
    );
    this.sessionStartHookEmitted = false;
  }

  async *streamTurn(input: GeneralAgentTurnInput): AsyncIterable<GeneralAgentStreamEvent> {
    await this.restorePromise;
    if (this.pendingHostedTool || this.activeVendoredRun) {
      throw new Error(
        "cannot start a new turn while another run is active or awaiting hosted tool input",
      );
    }
    this.transcriptPath = await resolveHostSessionFile(
      this.sessionStore,
      this.params.identity,
      this.params.sessionFile,
    );
    await this.ensureTranscriptPath();
    await this.emitSessionStartHookIfNeeded();
    await this.logSystemPrompt();
    this.loggerSink.emitRaw({
      type: "query_started",
      sessionId: this.params.identity.sessionId,
      sessionKey: this.params.identity.sessionKey,
      modelRef: this.params.modelRef,
    });
    await this.appendTranscript({
      type: "message",
      role: input.role,
      content: input.content,
      timestamp: Date.now(),
    });
    this.bumpUsage(input);

    if (this.stopRequested) {
      yield* this.emitEvents(createStopEvents("stop_requested"));
      return;
    }

    this.currentRunId = randomUUID();

    // Get API key — explicit config takes priority, then fall back to env
    const apiKey = this.params.anthropicApiKey ?? this.options.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      const hostedTool = this.resolveHostedTool(input);
      if (hostedTool) {
        const callId = randomUUID();
        const beforeResult = await this.runBeforeToolCallHooks({
          toolCallId: callId,
          toolName: hostedTool.name,
          args: {},
        });
        if (beforeResult?.block) {
          yield* this.emitBlockedHostedToolFallback({
            callId,
            toolName: hostedTool.name,
            input: this.toToolInputRecord(beforeResult.args),
            reason: beforeResult.reason ?? "Tool execution was blocked",
          });
          this.currentRunId = null;
          return;
        }
        const pending: PendingHostedToolCall = {
          callId,
          toolName: hostedTool.name,
          input: this.toToolInputRecord(beforeResult?.args),
        };
        this.pendingHostedTool = pending;
        await this.appendTranscript({
          type: "tool_call",
          callId: pending.callId,
          toolName: pending.toolName,
          input: pending.input,
          timestamp: Date.now(),
        });
        await this.saveSessionState();
        this.loggerSink.emitInfo({
          category: "tool_call",
          message: pending.toolName,
          data: { callId: pending.callId, toolName: pending.toolName, sessionId: this.params.identity.sessionId },
        });
        this.activeVendoredRun = this.createFallbackHostedToolRun(pending);
        this.activeVendoredRun.pendingNext = this.activeVendoredRun.iterator.next();
        yield* this.emitEvents(createHostedToolSuspendEvents(pending));
        return;
      }

      // §16: Missing credentials must fail loudly — no silent stub responses.
      this.currentRunId = null;
      throw new Error(
        "No API key provided. Set anthropicApiKey in SDK options or session params to use the LLM. " +
        "The SDK does not fall back to stub completions when credentials are missing.",
      );
    }

    // --- Real Anthropic path using vendored agent loop ---
    yield* this.runWithVendoredLoop(input, apiKey);
  }

  injectMessage(_input: GeneralAgentTurnInput): boolean {
    return this.pendingHostedTool === null;
  }

  async *submitHostedToolResult(
    input: GeneralAgentHostedToolResultInput,
  ): AsyncIterable<GeneralAgentStreamEvent> {
    await this.restorePromise;
    const pending = this.assertPendingHostedTool(input.callId);
    if (!this.activeVendoredRun) {
      yield* this.resumeHostedToolWithoutActiveRun(
        pending,
        this.createHostedToolSuccessResult(input.output, input.details),
        false,
      );
      return;
    }
    this.pendingHostedTool = null;
    this.pendingHostedToolContinuation = null;
    this.hostedToolBridge.submitResult(input.callId, input.output, input.details);
    yield* this.drainActiveVendoredRun();
  }

  async *submitHostedToolError(
    input: GeneralAgentHostedToolErrorInput,
  ): AsyncIterable<GeneralAgentStreamEvent> {
    await this.restorePromise;
    const pending = this.assertPendingHostedTool(input.callId);
    if (!this.activeVendoredRun) {
      yield* this.resumeHostedToolWithoutActiveRun(
        pending,
        this.createHostedToolErrorResult(input.error, input.details),
        true,
      );
      return;
    }
    this.pendingHostedTool = null;
    this.pendingHostedToolContinuation = null;
    this.hostedToolBridge.submitError(input.callId, input.error, input.details);
    yield* this.drainActiveVendoredRun();
  }

  requestStop(): void {
    this.stopRequested = true;
    this.abortController?.abort();
  }

  clearStop(): void {
    this.stopRequested = false;
  }

  isStopRequested(): boolean {
    return this.stopRequested;
  }

  async reset(reason = "manual"): Promise<void> {
    await this.restorePromise;
    await this.ensureTranscriptPath();

    await this.hookRunner.runBeforeReset(
      {
        sessionFile: this.transcriptPath ?? undefined,
        messages: [...this.agentMessages],
        reason,
      },
      this.createAgentHookContext(),
    );

    this.abortController?.abort();
    const activeRun = this.activeVendoredRun;
    this.activeVendoredRun = null;
    this.abortController = null;
    this.pendingHostedTool = null;
    this.pendingHostedToolContinuation = null;
    this.currentRunId = null;
    this.toolCallStartedAt.clear();
    this.agentMessages = [];
    this.usageSnapshot = null;
    this.lastCompactionAt = 0;
    this.stopRequested = false;

    await activeRun?.dispose?.();
    await fs.writeFile(this.transcriptPath!, "", "utf8");
    await this.saveSessionState();
  }

  async requestCompaction(): Promise<void> {
    await this.performCompaction("manual_request");
  }

  async maybeCompactByTokens(options?: GeneralAgentCompactionOptions): Promise<void> {
    const snapshot = this.usageSnapshot;
    if (!snapshot) return;
    const threshold = options?.usedPctThreshold ?? 85;
    const cooldownMs = options?.cooldownMs ?? 60_000;
    const now = Date.now();
    if (snapshot.usedPct >= threshold && now - this.lastCompactionAt >= cooldownMs) {
      await this.performCompaction("token_threshold");
    }
  }

  private async performCompaction(reason: string): Promise<void> {
    // Sanitize message ordering before compaction
    this.agentMessages = sanitizeMessages(this.agentMessages);

    const messagesBefore = this.agentMessages;
    if (messagesBefore.length === 0) {
      return;
    }

    // Buffer compaction_started event for the next drain cycle
    this.pendingCompactionEvents.push({ kind: "compaction_started", reason });

    // Fire before_compaction hook
    await this.hookRunner.runBeforeCompaction(
      {
        messageCount: messagesBefore.length,
        compactingCount: messagesBefore.length,
        tokenCount: this.usageSnapshot?.usedInputTokens,
        messages: [...messagesBefore],
        sessionFile: this.transcriptPath ?? undefined,
      },
      this.createAgentHookContext(),
    );

    // Perform truncation-based compaction
    const result = compactMessages(messagesBefore);

    // Replace the session's message history
    this.agentMessages = result.messages;
    this.lastCompactionAt = Date.now();

    // Update the usage snapshot to reflect compacted state
    if (this.usageSnapshot) {
      this.usageSnapshot = {
        ...this.usageSnapshot,
        usedInputTokens: result.estimatedTokens,
        usedPct: Number(
          ((result.estimatedTokens / this.usageSnapshot.contextWindow) * 100).toFixed(4),
        ),
        capturedAtMs: Date.now(),
      };
    }

    // Fire after_compaction hook
    await this.hookRunner.runAfterCompaction(
      {
        messageCount: result.messages.length,
        tokenCount: result.estimatedTokens,
        compactedCount: result.removedCount,
        sessionFile: this.transcriptPath ?? undefined,
      },
      this.createAgentHookContext(),
    );

    // Buffer compaction_finished event
    this.pendingCompactionEvents.push({
      kind: "compaction_finished",
      reason,
      tokensAfter: result.estimatedTokens,
    });

    this.loggerSink.emitInfo({
      category: "system",
      message: `compaction completed: removed ${result.removedCount} messages (reason: ${reason})`,
      data: {
        sessionId: this.params.identity.sessionId,
        reason,
        removedCount: result.removedCount,
        messagesAfter: result.messages.length,
        estimatedTokens: result.estimatedTokens,
      },
    });

    await this.saveSessionState();
  }

  getSessionId(): string {
    return this.params.identity.sessionId;
  }

  getTranscriptPath(): string | null {
    return this.transcriptPath;
  }

  getUsageSnapshot(): GeneralAgentUsageSnapshot | null {
    return this.usageSnapshot;
  }

  getCurrentQuery(): GeneralAgentCurrentQueryLike | null {
    return this.currentQuery;
  }

  async listCheckpoints(): Promise<GeneralAgentFileCheckpoint[]> {
    await this.restorePromise;
    return this.checkpointManager.listCheckpoints();
  }

  async restoreCheckpoint(id: string): Promise<void> {
    await this.restorePromise;
    await this.checkpointManager.restoreCheckpoint(id);
  }

  setDynamicMcpServers(servers: Record<string, GeneralAgentMcpServerConfig>): void {
    this.applyDynamicMcpServers(servers);
    this.pendingDynamicMcpServerOverride = this.restoreCompleted
      ? null
      : structuredClone(servers);
    this.persistSessionStateInBackground();
  }

  getDynamicMcpServers(): Record<string, GeneralAgentMcpServerConfig> {
    return structuredClone(this.dynamicMcpServers);
  }

  closeInput(): void {}

  private async getMcpServerStatus(): Promise<GeneralAgentMcpServerStatus[]> {
    await this.restorePromise;
    return Object.entries(this.dynamicMcpServers).map(([serverName, config]) => ({
      serverName,
      transport: config.transport,
      enabled: !this.disabledMcpServers.has(serverName),
      supported: true,
      error: undefined,
    }));
  }

  private async toggleMcpServer(serverName: string, enabled: boolean): Promise<void> {
    await this.restorePromise;
    if (!(serverName in this.dynamicMcpServers)) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }
    if (enabled) {
      this.disabledMcpServers.delete(serverName);
    } else {
      this.disabledMcpServers.add(serverName);
    }
    await this.saveSessionState();
  }

  private getEnabledDynamicMcpServers(): Array<{
    serverName: string;
    config: GeneralAgentMcpServerConfig;
  }> {
    return Object.entries(this.dynamicMcpServers)
      .filter(([serverName]) => !this.disabledMcpServers.has(serverName))
      .map(([serverName, config]) => ({
        serverName,
        config,
      }));
  }

  private async emitSessionStartHookIfNeeded(): Promise<void> {
    if (this.sessionStartHookEmitted) {
      return;
    }
    this.sessionStartHookEmitted = true;
    this.sessionStartedAtMs = Date.now();
    await this.hookRunner.runSessionStart(
      {
        sessionId: this.params.identity.sessionId,
        sessionKey: this.params.identity.sessionKey,
        resumedFrom: this.resumeOriginSessionId ?? this.forkedFromSessionId,
      },
      {
        agentId: inferAgentIdFromSessionKey(this.params.identity.sessionKey),
        sessionId: this.params.identity.sessionId,
        sessionKey: this.params.identity.sessionKey,
      },
    );
    this.resumeOriginSessionId = undefined;
  }

  private createAgentHookContext(): GeneralAgentAgentHookContext {
    return {
      agentId: inferAgentIdFromSessionKey(this.params.identity.sessionKey),
      sessionKey: this.params.identity.sessionKey,
      sessionId: this.params.identity.sessionId,
      workspaceDir: this.options.workspaceDir,
    };
  }

  private async prepareHookedRunState(promptText: string): Promise<{
    modelRef: string;
    promptBuild: GeneralAgentBeforePromptBuildResult;
  }> {
    const hookCtx = this.createAgentHookContext();
    const beforeModelResolve = await this.hookRunner.runBeforeModelResolve(
      { prompt: promptText },
      hookCtx,
    );
    const legacyBeforeAgentStart = await this.hookRunner.runBeforeAgentStart(
      { prompt: promptText, messages: this.agentMessages },
      hookCtx,
    );
    const beforePromptBuild = await this.hookRunner.runBeforePromptBuild(
      {
        prompt: promptText,
        messages: this.agentMessages,
      },
      hookCtx,
    );

    const modelRef = applyModelResolveOverride(this.params.modelRef, {
      providerOverride:
        beforeModelResolve?.providerOverride ?? legacyBeforeAgentStart?.providerOverride,
      modelOverride: beforeModelResolve?.modelOverride ?? legacyBeforeAgentStart?.modelOverride,
    });

    return {
      modelRef,
      promptBuild: {
        systemPrompt: beforePromptBuild?.systemPrompt ?? legacyBeforeAgentStart?.systemPrompt,
        prependContext: joinPresentTextSegments(
          beforePromptBuild?.prependContext,
          legacyBeforeAgentStart?.prependContext,
        ),
        prependSystemContext: joinPresentTextSegments(
          beforePromptBuild?.prependSystemContext,
          legacyBeforeAgentStart?.prependSystemContext,
        ),
        appendSystemContext: joinPresentTextSegments(
          beforePromptBuild?.appendSystemContext,
          legacyBeforeAgentStart?.appendSystemContext,
        ),
      },
    };
  }

  private applySystemPromptTransforms(
    promptBuild: GeneralAgentBeforePromptBuildResult,
  ): string {
    const baseSystemPrompt = promptBuild.systemPrompt ?? this.params.systemPrompt;
    const prepended = joinPresentTextSegments(promptBuild.prependSystemContext, baseSystemPrompt);
    return joinPresentTextSegments(prepended, promptBuild.appendSystemContext) ?? baseSystemPrompt;
  }

  private applyPrependContextToInput(
    input: GeneralAgentTurnInput,
    prependContext?: string,
  ): GeneralAgentTurnInput {
    if (!prependContext) {
      return input;
    }

    const textIndex = input.content.findIndex((entry) => entry.type === "text");
    const content = input.content.map((entry, index) => {
      if (entry.type === "text" && index === textIndex) {
        return {
          ...entry,
          text: joinPresentTextSegments(prependContext, entry.text) ?? entry.text,
        };
      }
      return entry;
    });

    if (textIndex >= 0) {
      return {
        ...input,
        content,
      };
    }

    return {
      ...input,
      content: [{ type: "text", text: prependContext }, ...input.content],
    };
  }

  // --- Steering & follow-up message callbacks for the vendored loop ---

  private async getSteeringMessages(): Promise<AgentMessage[]> {
    // Future: inject system-level heartbeat or guidance messages
    // For now, return empty to preserve current behavior while enabling the seam
    return [];
  }

  private async getFollowUpMessages(): Promise<AgentMessage[]> {
    // Future: allow the host or hooks to inject follow-up messages
    // that keep the agent working after it would otherwise stop
    return [];
  }

  // --- Vendored loop integration ---

  private async *runWithVendoredLoop(
    input: GeneralAgentTurnInput,
    apiKey: string,
  ): AsyncIterable<GeneralAgentStreamEvent> {
    // Sanitize message ordering before running the loop
    this.agentMessages = sanitizeMessages(this.agentMessages);

    const promptText = this.extractText(input);
    const hookedRunState = await this.prepareHookedRunState(promptText);
    const model = modelFromRef(hookedRunState.modelRef);
    const transformedInput = this.applyPrependContextToInput(
      input,
      hookedRunState.promptBuild.prependContext,
    );
    const effectivePromptText = this.extractText(transformedInput);
    const modelIdentity = splitModelRef(hookedRunState.modelRef, model.provider);

    const { agentTools, dispose } = await this.createVendoredAgentTools();

    // Build user message
    const userMessage: UserMessage = {
      role: "user",
      content: this.buildUserContent(transformedInput),
      timestamp: Date.now(),
    };

    // Build agent context
    const context: AgentContext = {
      systemPrompt: this.applySystemPromptTransforms(hookedRunState.promptBuild),
      messages: this.agentMessages,
      tools: agentTools,
    };

    // Create abort controller for signal propagation
    this.abortController = new AbortController();
    if (this.stopRequested) {
      this.abortController.abort();
    }

    const hookState: ActiveVendoredRun["hookState"] = {
      provider: modelIdentity.provider,
      model: modelIdentity.model,
      prompt: effectivePromptText,
      systemPrompt: context.systemPrompt,
      imagesCount: transformedInput.content.filter((entry) => entry.type === "image").length,
      startedAt: Date.now(),
      assistantTexts: [],
    };

    await this.hookRunner.runLlmInput(
      {
        runId: this.currentRunId!,
        sessionId: this.params.identity.sessionId,
        provider: hookState.provider,
        model: hookState.model,
        systemPrompt: hookState.systemPrompt,
        prompt: hookState.prompt,
        historyMessages: [...this.agentMessages],
        imagesCount: hookState.imagesCount,
      },
      this.createAgentHookContext(),
    );

    // Run the vendored loop
    const eventStream = agentLoop(
      [userMessage],
      context,
      {
        model,
        apiKey,
        convertToLlm: (messages: AgentMessage[]) => messages as Message[],
        reasoning: model.reasoning ? "high" : undefined,
        toolExecution: this.hostedTools.length > 0 ? "sequential" : undefined,
        getSteeringMessages: () => this.getSteeringMessages(),
        getFollowUpMessages: () => this.getFollowUpMessages(),
        beforeToolCall: async ({ toolCall, args }) =>
          this.runBeforeToolCallHooks({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args,
          }),
        afterToolCall: async ({ toolCall, args, result, isError }) => {
          await this.runAfterToolCallHooks({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args,
            result,
            isError: isError || this.hostedToolBridge.hasSubmittedError(toolCall.id),
          });
          return undefined;
        },
      },
      this.abortController.signal,
    );
    this.activeVendoredRun = {
      iterator: eventStream[Symbol.asyncIterator](),
      context,
      pendingNext: null,
      dispose,
      resolvedModelRef: hookedRunState.modelRef,
      hookState,
    };
    yield* this.drainActiveVendoredRun();
  }

  private async createVendoredAgentTools(): Promise<{
    agentTools: AgentTool[];
    dispose: () => Promise<void>;
  }> {
    const agentTools: AgentTool[] = [];

    for (const localTool of this.localTools) {
      agentTools.push(this.wrapLocalToolAsAgentTool(localTool));
    }

    for (const hostedTool of this.hostedTools) {
      if (isToolAllowedInEmbeddedMode(hostedTool.name)) {
        agentTools.push(this.hostedToolBridge.createAgentTool(hostedTool));
      }
    }

    const mcpRuntime = await createDynamicMcpToolRuntime({
      workspaceDir: this.options.workspaceDir,
      servers: this.getEnabledDynamicMcpServers(),
      reservedToolNames: agentTools.map((tool) => tool.name),
    });
    agentTools.push(...mcpRuntime.tools);

    return {
      agentTools,
      dispose: () => mcpRuntime.dispose(),
    };
  }

  /**
   * Wrap an GeneralAgentTool as an AgentTool for the vendored loop.
   */
  private wrapLocalToolAsAgentTool(tool: GeneralAgentTool): AgentTool {
    return {
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: async (toolCallId: string, params: any, signal?: AbortSignal) => {
        const result = await tool.execute(toolCallId, params, signal);
        // Convert GeneralAgentToolResult → AgentToolResult
        return {
          content: result.content.map((c) => {
            if (c.type === "text") return { type: "text" as const, text: c.text };
            if (c.type === "image") {
              return {
                type: "image" as const,
                data: c.source.data,
                mimeType: c.source.media_type,
              };
            }
            return c as any;
          }),
          details: result.details,
        };
      },
    };
  }

  private wrapToolWithCheckpointing(tool: GeneralAgentTool): GeneralAgentTool {
    if (!isCheckpointedToolName(tool.name)) {
      return tool;
    }

    return {
      ...tool,
      execute: async (callId: string, params: unknown, signal?: AbortSignal) => {
        const checkpoint = await this.captureToolCheckpoint(tool.name, callId, params);
        try {
          const result = await tool.execute(callId, params, signal);
          if (isToolResultFailure(result)) {
            await this.rollbackCheckpoint(checkpoint);
            return result;
          }
          this.commitCheckpoint(checkpoint);
          return result;
        } catch (error) {
          await this.rollbackCheckpoint(checkpoint);
          throw error;
        }
      },
    };
  }

  /**
   * First-class subagent runtime: creates and runs a child session internally.
   * Called by the `subagents` core built-in tool.
   */
  private async runChildSession(params: SubagentRunParams): Promise<SubagentRunResult> {
    const childSessionId = `${this.params.identity.sessionId}:sub:${randomUUID().slice(0, 8)}`;
    const childSessionKey = `${this.params.identity.sessionKey}:subagent:${childSessionId}`;
    const agentId = params.label ?? "subagent";

    const hookCtx: import("../../public/hooks.js").GeneralAgentSubagentHookContext = {
      runId: this.currentRunId ?? undefined,
      childSessionKey,
      requesterSessionKey: this.params.identity.sessionKey,
    };

    // 1. Fire subagent_spawning hook
    const spawningResult = await this.hookRunner.runSubagentSpawning(
      {
        childSessionKey,
        agentId,
        label: params.label,
        mode: "run",
        threadRequested: false,
      },
      hookCtx,
    );

    if (spawningResult?.status === "error") {
      return {
        ok: false,
        output: "",
        childSessionId,
        error: typeof (spawningResult as any).error === "string"
          ? (spawningResult as any).error
          : "Subagent spawning blocked by hook",
      };
    }

    // 2. Fire subagent_delivery_target hook
    await this.hookRunner.runSubagentDeliveryTarget(
      {
        childSessionKey,
        requesterSessionKey: this.params.identity.sessionKey,
        expectsCompletionMessage: true,
      },
      hookCtx,
    );

    // 3. Create child session transcript path
    const childTranscriptPath = path.join(
      path.dirname(this.transcriptPath ?? this.params.sessionFile),
      `${childSessionId}.jsonl`,
    );

    // 4. Build child session with scoped tools (exclude subagents to prevent infinite recursion)
    const childOptions: GeneralAgentSdkOptions = {
      ...this.options,
      hostedTools: [], // child has no hosted tools — only local/built-in
    };

    const child = new GeneralAgentSdkSession(childOptions, {
      identity: {
        mode: this.params.identity.mode,
        sessionId: childSessionId,
        sessionKey: childSessionKey,
      },
      systemPrompt: params.instructions,
      modelRef: params.modelRef ?? this.params.modelRef,
      sessionFile: childTranscriptPath,
      anthropicApiKey: this.params.anthropicApiKey ?? this.options.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY,
    });

    // Remove the subagents tool from the child to prevent infinite recursion
    const childLocalTools = child.localTools.filter((tool) => tool.name !== "subagents");
    // If allowedTools is specified, further filter down
    if (params.allowedTools) {
      const allowed = new Set(params.allowedTools);
      (child as any).localTools = childLocalTools.filter((tool: GeneralAgentTool) => allowed.has(tool.name));
    } else {
      (child as any).localTools = childLocalTools;
    }

    // 5. Fire subagent_spawned hook
    await this.hookRunner.runSubagentSpawned(
      {
        childSessionKey,
        agentId,
        mode: "run",
        threadRequested: false,
        runId: this.currentRunId ?? randomUUID(),
      },
      hookCtx,
    );

    // 6. Run child to completion
    let output = "";
    let ok = true;
    let error: string | undefined;

    try {
      const events = child.streamTurn({
        role: "user",
        content: [{ type: "text", text: params.task }],
      });

      for await (const event of events) {
        if (event.kind === "assistant_delta") {
          output += event.text;
        }
      }
    } catch (err) {
      ok = false;
      error = err instanceof Error ? err.message : String(err);
    }

    // 7. Fire subagent_ended hook
    await this.hookRunner.runSubagentEnded(
      {
        targetSessionKey: childSessionKey,
        targetKind: "subagent",
        reason: ok ? "completed" : "error",
        outcome: ok ? "ok" : "error",
        runId: this.currentRunId ?? undefined,
        endedAt: Date.now(),
      },
      hookCtx,
    );

    // 8. Cleanup child session
    await child.shutdown();

    return { ok, output, childSessionId, error };
  }

  private createFallbackHostedToolRun(pending: PendingHostedToolCall): ActiveVendoredRun {
    const finishTurn = createFallbackAssistantMessage("");
    const iterator = (async function* (
      session: GeneralAgentSdkSession,
      pendingCall: PendingHostedToolCall,
    ): AsyncIterable<AgentEvent> {
      const hostedTool = session.hostedTools.find((tool) => tool.name === pendingCall.toolName);
      if (!hostedTool) {
        throw new Error(`hosted tool not found: ${pendingCall.toolName}`);
      }

      const tool = session.hostedToolBridge.createAgentTool(hostedTool);
      const result = await tool.execute(pendingCall.callId, pendingCall.input);
      const isError = session.hostedToolBridge.consumeSubmittedError(pendingCall.callId);
      await session.runAfterToolCallHooks({
        toolCallId: pendingCall.callId,
        toolName: pendingCall.toolName,
        args: pendingCall.input,
        result,
        isError,
      });
      yield {
        type: "tool_execution_end",
        toolCallId: pendingCall.callId,
        toolName: pendingCall.toolName,
        result,
        isError,
      };
      yield {
        type: "turn_end",
        message: finishTurn,
        toolResults: [],
      };
    })(this, pending);

    return {
      iterator: iterator[Symbol.asyncIterator](),
      context: {
        systemPrompt: this.params.systemPrompt,
        messages: this.agentMessages,
        tools: [],
      },
      pendingNext: null,
    };
  }

  private async *drainActiveVendoredRun(): AsyncIterable<GeneralAgentStreamEvent> {
    const activeRun = this.activeVendoredRun;
    if (!activeRun) {
      return;
    }

    // Flush any buffered compaction events before proceeding
    if (this.pendingCompactionEvents.length > 0) {
      const buffered = this.pendingCompactionEvents;
      this.pendingCompactionEvents = [];
      yield* this.emitEvents(buffered);
    }

    try {
      while (true) {
        const next = activeRun.pendingNext
          ? await activeRun.pendingNext
          : await activeRun.iterator.next();
        activeRun.pendingNext = null;
        if (next.done) {
          this.activeVendoredRun = null;
          this.abortController = null;
          this.currentRunId = null;
          await activeRun.dispose?.();
          return;
        }

        const event = this.normalizeVendoredEvent(next.value);
        await this.persistVendoredEvent(event);
        await this.runVendoredLifecycleHooks(activeRun, event);

        // Capture updated message history from agent_end so multi-turn memory works.
        // The agentLoop creates a new currentContext inside runAgentLoop that accumulates
        // both the original history and new messages. The agent_end.messages contains only
        // the new messages produced during this turn (user prompt + assistant responses + tool results).
        // We must merge them with the pre-existing history from activeRun.context.messages.
        if (event.type === "agent_end" && event.messages) {
          this.agentMessages = [...activeRun.context.messages, ...event.messages];
        }

        if (event.type === "tool_execution_start" && this.isHostedToolName(event.toolName)) {
          activeRun.pendingNext = activeRun.iterator.next();
          this.pendingHostedTool = {
            callId: event.toolCallId,
            toolName: event.toolName,
            input: this.toToolInputRecord(event.args),
          };
          this.pendingHostedToolContinuation = this.createPendingHostedToolContinuation(
            activeRun,
            event,
          );
          await this.saveSessionState();
          yield* this.emitEvents(createHostedToolSuspendEvents(this.pendingHostedTool));
          return;
        }

        const streamEvents = adaptAgentEventToStreamEvents(event);
        for (const streamEvent of streamEvents) {
          this.loggerSink.emitRaw(streamEvent as Record<string, unknown>);
          yield streamEvent;
        }
      }
    } catch (error) {
      this.activeVendoredRun = null;
      this.abortController = null;
      this.currentRunId = null;
      await activeRun.dispose?.();
      throw error;
    }
  }

  private async runVendoredLifecycleHooks(
    activeRun: ActiveVendoredRun,
    event: AgentEvent,
  ): Promise<void> {
    const hookState = activeRun.hookState;
    if (!hookState) {
      return;
    }

    if (event.type === "message_end") {
      const assistant = this.asAssistantMessage(event.message);
      if (!assistant) {
        return;
      }
      hookState.lastAssistant = assistant;
      const text = this.extractAssistantText(assistant);
      if (text) {
        hookState.assistantTexts.push(text);
      }
      return;
    }

    if (event.type !== "agent_end") {
      return;
    }

    const hookMessages = hookState.messagePrefix
      ? [...hookState.messagePrefix, ...event.messages]
      : event.messages;
    const lastAssistant = hookState.lastAssistant ?? this.findLastAssistantMessage(hookMessages);
    const { success, error } = this.getAgentEndStatus(lastAssistant);
    const hookContext = this.createAgentHookContext();

    await this.hookRunner.runAgentEnd(
      {
        messages: hookMessages,
        success,
        error,
        durationMs: Date.now() - hookState.startedAt,
      },
      hookContext,
    );

    await this.hookRunner.runLlmOutput(
      {
        runId: this.currentRunId!,
        sessionId: this.params.identity.sessionId,
        provider: hookState.provider,
        model: hookState.model,
        assistantTexts: hookState.assistantTexts,
        lastAssistant,
        usage: lastAssistant?.usage
          ? {
              input: lastAssistant.usage.input,
              output: lastAssistant.usage.output,
              cacheRead: lastAssistant.usage.cacheRead,
              cacheWrite: lastAssistant.usage.cacheWrite,
              total: lastAssistant.usage.totalTokens,
            }
          : undefined,
      },
      hookContext,
    );
  }

  private createPendingHostedToolContinuation(
    activeRun: ActiveVendoredRun,
    event: Extract<AgentEvent, { type: "tool_execution_start" }>,
  ): PendingHostedToolContinuation | null {
    if (!activeRun.resolvedModelRef || !activeRun.hookState || !this.currentRunId) {
      return null;
    }

    const lastAssistant = this.findLastAssistantMessage(activeRun.context.messages);
    if (!lastAssistant) {
      return null;
    }

    const toolCalls = lastAssistant.content.filter(
      (
        content,
      ): content is Extract<AssistantMessage["content"][number], { type: "toolCall" }> =>
        content.type === "toolCall",
    );

    if (toolCalls.length === 0) {
      return null;
    }

    // Verify the hosted tool call is among the tool calls in the last assistant message
    const hostedToolCall = toolCalls.find(
      (tc) => tc.id === event.toolCallId && tc.name === event.toolName,
    );
    if (!hostedToolCall) {
      return null;
    }

    const strategy: PendingHostedToolContinuation["strategy"] =
      toolCalls.length === 1
        ? "agent_loop_continue_single_tool"
        : "agent_loop_continue_multi_tool";

    const toolStartedAtMs = this.toolCallStartedAt.get(event.toolCallId);

    return {
      strategy,
      runId: this.currentRunId,
      resolvedModelRef: activeRun.resolvedModelRef,
      systemPrompt: activeRun.context.systemPrompt,
      messages: structuredClone(activeRun.context.messages),
      toolStartedAtMs,
      hookState: {
        provider: activeRun.hookState.provider,
        model: activeRun.hookState.model,
        prompt: activeRun.hookState.prompt,
        systemPrompt: activeRun.hookState.systemPrompt,
        imagesCount: activeRun.hookState.imagesCount,
        startedAtMs: activeRun.hookState.startedAt,
        assistantTexts: [...activeRun.hookState.assistantTexts],
        lastAssistant: activeRun.hookState.lastAssistant
          ? structuredClone(activeRun.hookState.lastAssistant)
          : undefined,
      },
    };
  }

  private async *resumeHostedToolWithoutActiveRun(
    pending: PendingHostedToolCall,
    result: AgentToolResult<any>,
    isError: boolean,
  ): AsyncIterable<GeneralAgentStreamEvent> {
    const continuation = this.pendingHostedToolContinuation;
    if (
      !continuation ||
      (continuation.strategy !== "agent_loop_continue_single_tool" &&
        continuation.strategy !== "agent_loop_continue_multi_tool")
    ) {
      throw new Error(
        `no active hosted tool run for callId: ${pending.callId}; restart-safe hosted tool continuation is not supported for this suspended run`,
      );
    }

    const toolResultMessage: ToolResultMessage = {
      role: "toolResult",
      toolCallId: pending.callId,
      toolName: pending.toolName,
      content: result.content,
      details: result.details,
      isError,
      timestamp: Date.now(),
    };

    if (continuation.toolStartedAtMs != null) {
      this.toolCallStartedAt.set(pending.callId, continuation.toolStartedAtMs);
    }

    this.pendingHostedTool = null;
    this.pendingHostedToolContinuation = null;
    this.currentRunId = continuation.runId;

    await this.runAfterToolCallHooks({
      toolCallId: pending.callId,
      toolName: pending.toolName,
      args: pending.input,
      result,
      isError,
    });
    await this.appendToolResultTranscript({
      type: "tool_result",
      callId: pending.callId,
      toolName: pending.toolName,
      output: result.content,
      details: result.details,
      isError,
      timestamp: toolResultMessage.timestamp,
    });

    const resumedMessages = [
      ...(structuredClone(continuation.messages) as AgentMessage[]),
      toolResultMessage,
    ];

    this.activeVendoredRun = await this.createRecoveredVendoredRun({
      messages: resumedMessages,
      resolvedModelRef: continuation.resolvedModelRef,
      systemPrompt: continuation.systemPrompt,
      hookState: {
        provider: continuation.hookState.provider,
        model: continuation.hookState.model,
        prompt: continuation.hookState.prompt,
        systemPrompt: continuation.hookState.systemPrompt,
        imagesCount: continuation.hookState.imagesCount,
        startedAt: continuation.hookState.startedAtMs,
        assistantTexts: [...continuation.hookState.assistantTexts],
        lastAssistant: continuation.hookState.lastAssistant
          ? structuredClone(continuation.hookState.lastAssistant)
          : undefined,
        messagePrefix: resumedMessages,
      },
    });

    yield* this.emitEvents([
      isError
        ? {
            kind: "tool_error" as const,
            callId: pending.callId,
            toolName: pending.toolName,
            error: this.extractToolError(result),
            details: result.details,
          }
        : {
            kind: "tool_result" as const,
            callId: pending.callId,
            toolName: pending.toolName,
            output: result.content,
            details: result.details,
          },
    ]);
    yield* this.drainActiveVendoredRun();
  }

  private async createRecoveredVendoredRun(params: {
    messages: AgentMessage[];
    resolvedModelRef: string;
    systemPrompt: string;
    hookState: NonNullable<ActiveVendoredRun["hookState"]>;
  }): Promise<ActiveVendoredRun> {
    const model = modelFromRef(params.resolvedModelRef);
    const { agentTools, dispose } = await this.createVendoredAgentTools();

    const context: AgentContext = {
      systemPrompt: params.systemPrompt,
      messages: params.messages,
      tools: agentTools,
    };

    this.abortController = new AbortController();
    if (this.stopRequested) {
      this.abortController.abort();
    }

    const eventStream = agentLoopContinue(
      context,
      {
        model,
        apiKey: this.params.anthropicApiKey ?? this.options.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY,
        convertToLlm: (messages: AgentMessage[]) => messages as Message[],
        reasoning: model.reasoning ? "high" : undefined,
        toolExecution: this.hostedTools.length > 0 ? "sequential" : undefined,
        getSteeringMessages: () => this.getSteeringMessages(),
        getFollowUpMessages: () => this.getFollowUpMessages(),
        beforeToolCall: async ({ toolCall, args }) =>
          this.runBeforeToolCallHooks({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args,
          }),
        afterToolCall: async ({ toolCall, args, result, isError }) => {
          await this.runAfterToolCallHooks({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args,
            result,
            isError: isError || this.hostedToolBridge.hasSubmittedError(toolCall.id),
          });
          return undefined;
        },
      },
      this.abortController.signal,
    );

    return {
      iterator: eventStream[Symbol.asyncIterator](),
      context,
      pendingNext: null,
      dispose,
      resolvedModelRef: params.resolvedModelRef,
      hookState: params.hookState,
    };
  }

  private async persistVendoredEvent(event: AgentEvent): Promise<void> {
    if (event.type === "tool_execution_start") {
      await this.appendTranscript({
        type: "tool_call",
        callId: event.toolCallId,
        toolName: event.toolName,
        input: event.args ?? {},
        timestamp: Date.now(),
      });
      return;
    }

    if (event.type === "tool_execution_end") {
      const entry: Extract<TranscriptEntry, { type: "tool_result" }> = {
        type: "tool_result",
        callId: event.toolCallId,
        toolName: event.toolName,
        output: event.result?.content ?? [],
        details: event.result?.details,
        isError: event.isError,
        timestamp: Date.now(),
      };
      await this.appendToolResultTranscript(entry);
      return;
    }

    if (event.type !== "message_end") {
      return;
    }

    const msg = event.message;
    if (!(msg && "role" in msg && msg.role === "assistant" && "content" in msg)) {
      return;
    }

    const textContent = (msg as any).content
      ?.filter((c: any) => c.type === "text")
      ?.map((c: any) => c.text)
      ?.join("\n") ?? "";
    if (textContent) {
      await this.appendTranscript({
        type: "assistant",
        text: textContent,
        timestamp: Date.now(),
      });
    }

    if ("usage" in msg && (msg as any).usage) {
      const usage = (msg as any).usage;
      const contextWindow = resolveContextWindow(this.params.modelRef);
      this.usageSnapshot = {
        usedInputTokens: usage.input ?? 0,
        contextWindow,
        usedPct: Number((((usage.input ?? 0) / contextWindow) * 100).toFixed(4)),
        capturedAtMs: Date.now(),
      };
    }
  }

  private normalizeVendoredEvent(event: AgentEvent): AgentEvent {
    if (
      event.type === "tool_execution_end" &&
      this.hostedToolBridge.consumeSubmittedError(event.toolCallId)
    ) {
      return {
        ...event,
        isError: true,
      };
    }
    return event;
  }

  private asAssistantMessage(message: AgentMessage | undefined): AssistantMessage | null {
    if (!(message && "role" in message && message.role === "assistant" && "content" in message)) {
      return null;
    }
    return message as AssistantMessage;
  }

  private findLastAssistantMessage(messages: AgentMessage[]): AssistantMessage | undefined {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const assistant = this.asAssistantMessage(messages[index]);
      if (assistant) {
        return assistant;
      }
    }
    return undefined;
  }

  private extractAssistantText(message: AssistantMessage): string {
    return message.content
      .filter(
        (content): content is Extract<AssistantMessage["content"][number], { type: "text" }> =>
          content.type === "text",
      )
      .map((content) => content.text)
      .join("\n");
  }

  private getAgentEndStatus(lastAssistant?: AssistantMessage): {
    success: boolean;
    error?: string;
  } {
    if (!lastAssistant) {
      return { success: true };
    }

    if (lastAssistant.stopReason === "error" || lastAssistant.stopReason === "aborted") {
      return {
        success: false,
        error:
          lastAssistant.errorMessage ??
          `assistant stop reason: ${lastAssistant.stopReason}`,
      };
    }

    return { success: true };
  }

  private buildUserContent(input: GeneralAgentTurnInput): string | Array<any> {
    const textParts = input.content.filter((c) => c.type === "text") as Array<{ type: "text"; text: string }>;
    const imageParts = input.content.filter((c) => c.type === "image");

    if (imageParts.length === 0) {
      return textParts.map((p) => p.text).join("\n");
    }

    return input.content.map((part) => {
      if (part.type === "text") return { type: "text", text: part.text };
      if (part.type === "image") {
        return {
          type: "image",
          data: (part as any).data,
          mimeType: (part as any).mimeType,
        };
      }
      return part;
    });
  }

  // --- Preserved utility methods ---

  private async restoreStoredState(): Promise<void> {
    const stored = await this.sessionStore.load(this.params.identity);
    if (stored) {
      if (stored.transcriptPath) this.transcriptPath = stored.transcriptPath;
      if (stored.usageSnapshot) this.usageSnapshot = stored.usageSnapshot;
      if (typeof stored.createdAtMs === "number") this.createdAtMs = stored.createdAtMs;
      if (typeof stored.forkedFromSessionId === "string") {
        this.forkedFromSessionId = stored.forkedFromSessionId;
      }
      this.pendingHostedTool = stored.pendingHostedTool
        ? {
            callId: stored.pendingHostedTool.callId,
            toolName: stored.pendingHostedTool.toolName,
            input: { ...stored.pendingHostedTool.input },
          }
        : null;
      this.pendingHostedToolContinuation = stored.pendingContinuation
        ? {
            strategy: stored.pendingContinuation.strategy,
            runId: stored.pendingContinuation.runId,
            resolvedModelRef: stored.pendingContinuation.resolvedModelRef,
            systemPrompt: stored.pendingContinuation.systemPrompt,
            messages: structuredClone(stored.pendingContinuation.messages) as AgentMessage[],
            toolStartedAtMs: stored.pendingContinuation.toolStartedAtMs,
            hookState: {
              provider: stored.pendingContinuation.hookState.provider,
              model: stored.pendingContinuation.hookState.model,
              prompt: stored.pendingContinuation.hookState.prompt,
              systemPrompt: stored.pendingContinuation.hookState.systemPrompt,
              imagesCount: stored.pendingContinuation.hookState.imagesCount,
              startedAtMs: stored.pendingContinuation.hookState.startedAtMs,
              assistantTexts: [...stored.pendingContinuation.hookState.assistantTexts],
              lastAssistant: stored.pendingContinuation.hookState.lastAssistant
                ? (structuredClone(
                    stored.pendingContinuation.hookState.lastAssistant,
                  ) as AssistantMessage)
                : undefined,
            },
          }
        : null;
      this.applyDynamicMcpServers(stored.dynamicMcpServers ?? {});
      this.disabledMcpServers.clear();
      for (const serverName of stored.disabledMcpServers ?? []) {
        this.disabledMcpServers.add(serverName);
      }
    }
    this.restoreCompleted = true;
    if (this.pendingDynamicMcpServerOverride) {
      this.applyDynamicMcpServers(this.pendingDynamicMcpServerOverride);
      this.pendingDynamicMcpServerOverride = null;
    }
  }

  private async logSystemPrompt(): Promise<void> {
    this.loggerSink.emitInfo({
      category: "system_prompt",
      message: this.params.systemPrompt.replace(/\n/g, "\\n"),
      data: {
        sessionId: this.params.identity.sessionId,
        sessionKey: this.params.identity.sessionKey,
        modelRef: this.params.modelRef,
      },
    });
    await this.appendTranscript({
      type: "system_prompt",
      prompt: this.params.systemPrompt,
      modelRef: this.params.modelRef,
      timestamp: Date.now(),
    });
  }

  private resolveHostedTool(input: GeneralAgentTurnInput): GeneralAgentHostedToolDefinition | null {
    const text = this.extractText(input).toLowerCase();
    for (const tool of this.hostedTools) {
      if (!isToolAllowedInEmbeddedMode(tool.name)) {
        this.loggerSink.emitWarn({
          category: "system",
          message: `blocked embedded tool: ${tool.name}`,
          data: { toolName: tool.name, sessionId: this.params.identity.sessionId },
        });
        continue;
      }
      if (text.includes(tool.name.toLowerCase())) return tool;
    }
    return null;
  }

  private extractText(input: GeneralAgentTurnInput): string {
    return input.content
      .filter((entry): entry is Extract<GeneralAgentTurnInput["content"][number], { type: "text" }> =>
        entry.type === "text",
      )
      .map((entry) => entry.text)
      .join("\n");
  }

  private bumpUsage(input: GeneralAgentTurnInput): void {
    const approximateInputTokens = Math.max(1, Math.ceil(this.extractText(input).length / 4));
    const previous = this.usageSnapshot?.usedInputTokens ?? 0;
    const contextWindow = this.usageSnapshot?.contextWindow ?? resolveContextWindow(this.params.modelRef);
    const usedInputTokens = previous + approximateInputTokens;
    this.usageSnapshot = {
      usedInputTokens,
      contextWindow,
      usedPct: Number(((usedInputTokens / contextWindow) * 100).toFixed(4)),
      capturedAtMs: Date.now(),
    };
  }

  private assertPendingHostedTool(callId: string): PendingHostedToolCall {
    if (!this.pendingHostedTool || this.pendingHostedTool.callId !== callId) {
      throw new Error(`no pending hosted tool call for callId: ${callId}`);
    }
    return this.pendingHostedTool;
  }

  private async ensureTranscriptPath(): Promise<void> {
    if (!this.transcriptPath) {
      this.transcriptPath = await this.sessionStore.resolveSessionFile(this.params.identity);
    }
    await fs.mkdir(path.dirname(this.transcriptPath), { recursive: true });
  }

  private async appendTranscript(entry: TranscriptEntry): Promise<void> {
    if (entry.type === "tool_result") {
      await this.appendToolResultTranscript(entry);
      return;
    }
    await this.ensureTranscriptPath();
    const writeResult = this.hookRunner.runBeforeMessageWrite(
      {
        message: entry,
        sessionKey: this.params.identity.sessionKey,
      },
      {
        sessionKey: this.params.identity.sessionKey,
      },
    );
    if (!writeResult?.block) {
      const finalEntry = writeResult?.message ?? entry;
      await this.appendTranscriptRaw(finalEntry as TranscriptEntry);
      return;
    }
    await this.saveSessionState();
  }

  private async appendToolResultTranscript(
    entry: Extract<TranscriptEntry, { type: "tool_result" }>,
  ): Promise<void> {
    await this.ensureTranscriptPath();
    const initialMessage = this.toToolResultMessage(entry);
    const persistedMessage =
      this.hookRunner.runToolResultPersist(
        {
          toolName: entry.toolName,
          toolCallId: entry.callId,
          message: initialMessage,
        },
        {
          sessionKey: this.params.identity.sessionKey,
          toolName: entry.toolName,
          toolCallId: entry.callId,
        },
      )?.message ?? initialMessage;
    const writeResult = this.hookRunner.runBeforeMessageWrite(
      {
        message: persistedMessage,
        sessionKey: this.params.identity.sessionKey,
      },
      {
        sessionKey: this.params.identity.sessionKey,
      },
    );
    if (!writeResult?.block) {
      const finalMessage = this.asToolResultMessage(writeResult?.message ?? persistedMessage);
      await this.appendTranscriptRaw(this.fromToolResultMessage(finalMessage, entry));
      return;
    }
    await this.saveSessionState();
  }

  private async appendTranscriptRaw(entry: TranscriptEntry): Promise<void> {
    await fs.appendFile(this.transcriptPath!, JSON.stringify(entry) + "\n", "utf-8");
    await this.saveSessionState();
  }

  private async saveSessionState(): Promise<void> {
    const now = Date.now();
    const storedSession = {
      sessionId: this.params.identity.sessionId,
      sessionKey: this.params.identity.sessionKey,
      mode: this.params.identity.mode,
      systemPrompt: this.params.systemPrompt,
      modelRef: this.params.modelRef,
      authProfileId: this.params.authProfileId,
      rawEventLogPath: this.params.rawEventLogPath,
      usageSnapshot: this.usageSnapshot ?? undefined,
      transcriptPath: this.transcriptPath,
      dynamicMcpServers: this.getDynamicMcpServers(),
      disabledMcpServers: Array.from(this.disabledMcpServers),
      createdAtMs: this.createdAtMs,
      updatedAtMs: now,
      forkedFromSessionId: this.forkedFromSessionId,
      pendingHostedTool: this.pendingHostedTool
        ? {
            callId: this.pendingHostedTool.callId,
            toolName: this.pendingHostedTool.toolName,
            input: { ...this.pendingHostedTool.input },
          }
        : null,
      pendingContinuation: this.pendingHostedToolContinuation
        ? {
            strategy: this.pendingHostedToolContinuation.strategy,
            runId: this.pendingHostedToolContinuation.runId,
            resolvedModelRef: this.pendingHostedToolContinuation.resolvedModelRef,
            systemPrompt: this.pendingHostedToolContinuation.systemPrompt,
            messages: structuredClone(this.pendingHostedToolContinuation.messages),
            toolStartedAtMs: this.pendingHostedToolContinuation.toolStartedAtMs,
            hookState: {
              provider: this.pendingHostedToolContinuation.hookState.provider,
              model: this.pendingHostedToolContinuation.hookState.model,
              prompt: this.pendingHostedToolContinuation.hookState.prompt,
              systemPrompt: this.pendingHostedToolContinuation.hookState.systemPrompt,
              imagesCount: this.pendingHostedToolContinuation.hookState.imagesCount,
              startedAtMs: this.pendingHostedToolContinuation.hookState.startedAtMs,
              assistantTexts: [...this.pendingHostedToolContinuation.hookState.assistantTexts],
              lastAssistant: this.pendingHostedToolContinuation.hookState.lastAssistant
                ? structuredClone(this.pendingHostedToolContinuation.hookState.lastAssistant)
                : undefined,
            },
          }
        : null,
    };
    await this.sessionStore.save(this.params.identity, storedSession);
    await this.metadataIndex.upsert(storedSession);
  }

  private persistSessionStateInBackground(): void {
    void this.saveSessionState().catch((error) => {
      this.loggerSink.emitWarn({
        category: "system",
        message: "failed to persist session state",
        data: {
          sessionId: this.params.identity.sessionId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    });
  }

  private applyDynamicMcpServers(servers: Record<string, GeneralAgentMcpServerConfig>): void {
    for (const key of Object.keys(this.dynamicMcpServers)) {
      delete this.dynamicMcpServers[key];
    }
    Object.assign(this.dynamicMcpServers, structuredClone(servers));
    for (const serverName of Array.from(this.disabledMcpServers)) {
      if (!(serverName in this.dynamicMcpServers)) {
        this.disabledMcpServers.delete(serverName);
      }
    }
  }

  private async *emitEvents(
    events: Iterable<GeneralAgentStreamEvent>,
  ): AsyncIterable<GeneralAgentStreamEvent> {
    for (const event of events) {
      this.loggerSink.emitRaw(event as Record<string, unknown>);
      yield event;
    }
  }

  private isHostedToolName(toolName: string): boolean {
    return this.hostedTools.some((tool) =>
      isToolAllowedInEmbeddedMode(tool.name) && tool.name === toolName
    );
  }

  private toToolInputRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private async runBeforeToolCallHooks(params: {
    toolCallId: string;
    toolName: string;
    args: unknown;
  }): Promise<{ args?: unknown; block?: boolean; reason?: string } | undefined> {
    const hasBeforeHooks = this.hookRunner.hasHooks("before_tool_call");
    const hasAfterHooks = this.hookRunner.hasHooks("after_tool_call");
    const ctx = this.createToolHookContext(params.toolName, params.toolCallId);
    if (hasAfterHooks) {
      this.toolCallStartedAt.set(params.toolCallId, Date.now());
    }
    let result:
      | {
          args?: unknown;
          block?: boolean;
          reason?: string;
        }
      | undefined;

    if (hasBeforeHooks) {
      const hookResult = await this.hookRunner.runBeforeToolCall(
        {
          toolName: params.toolName,
          params: this.toToolInputRecord(params.args),
          runId: this.currentRunId ?? undefined,
          toolCallId: params.toolCallId,
        },
        ctx,
      );
      if (hookResult) {
        result = {
          args: hookResult.params,
          block: hookResult.block,
          reason: hookResult.blockReason,
        };
      }
    }

    return result;
  }

  private async runAfterToolCallHooks(params: {
    toolCallId: string;
    toolName: string;
    args: unknown;
    result: AgentToolResult<any>;
    isError: boolean;
  }): Promise<void> {
    if (!this.hookRunner.hasHooks("after_tool_call")) {
      return;
    }

    const startedAt = this.toolCallStartedAt.get(params.toolCallId);
    this.toolCallStartedAt.delete(params.toolCallId);
    await this.hookRunner.runAfterToolCall(
      {
        toolName: params.toolName,
        params: this.toToolInputRecord(params.args),
        runId: this.currentRunId ?? undefined,
        toolCallId: params.toolCallId,
        result: params.result.details,
        error: params.isError ? this.extractToolError(params.result) : undefined,
        durationMs: startedAt != null ? Date.now() - startedAt : undefined,
      },
      this.createToolHookContext(params.toolName, params.toolCallId),
    );
  }

  private createToolHookContext(
    toolName: string,
    toolCallId: string,
  ): GeneralAgentToolHookContext {
    return {
      sessionId: this.params.identity.sessionId,
      sessionKey: this.params.identity.sessionKey,
      runId: this.currentRunId ?? undefined,
      toolName,
      toolCallId,
    };
  }

  private extractToolError(result: AgentToolResult<any>): string {
    const firstContent = result.content[0];
    if (firstContent?.type === "text") {
      return firstContent.text;
    }
    return "Tool execution failed";
  }

  private async captureToolCheckpoint(
    toolName: string,
    callId: string,
    params: unknown,
  ): Promise<CapturedFileCheckpoint | null> {
    const files = await this.resolveCheckpointTargets(toolName, params);
    if (files.length === 0) {
      return null;
    }
    return this.checkpointManager.capture({
      toolName,
      callId,
      files,
    });
  }

  private commitCheckpoint(checkpoint: CapturedFileCheckpoint | null): void {
    if (!checkpoint) {
      return;
    }
    this.checkpointManager.commit(checkpoint);
  }

  private async rollbackCheckpoint(checkpoint: CapturedFileCheckpoint | null): Promise<void> {
    if (!checkpoint) {
      return;
    }
    await this.checkpointManager.restorePending(checkpoint);
  }

  private async resolveCheckpointTargets(
    toolName: string,
    params: unknown,
  ): Promise<FileCheckpointTarget[]> {
    const input = this.toToolInputRecord(params);

    if (toolName === "write" || toolName === "edit") {
      if (typeof input.path !== "string") {
        return [];
      }
      const absolutePath = resolveToCwd(input.path, this.options.workspaceDir);
      return [createCheckpointTarget(absolutePath, this.options.workspaceDir)];
    }

    if (toolName === "apply_patch") {
      if (typeof input.input !== "string") {
        return [];
      }
      if (!input.input.trim()) {
        return [];
      }
      const targets = await resolveApplyPatchTargets(input.input, this.options.workspaceDir);
      return targets.map((target) => ({
        absolutePath: target.resolved,
        displayPath: target.display,
      }));
    }

    return [];
  }

  private toToolResultMessage(
    entry: Extract<TranscriptEntry, { type: "tool_result" }>,
  ): GeneralAgentToolResultMessage {
    return {
      role: "toolResult",
      toolCallId: entry.callId,
      toolName: entry.toolName,
      content: Array.isArray(entry.output) ? (entry.output as GeneralAgentToolResultMessage["content"]) : [],
      details: entry.details,
      isError: entry.isError ?? false,
      timestamp: entry.timestamp,
    };
  }

  private asToolResultMessage(
    message: GeneralAgentBeforeMessageWriteMessage,
  ): GeneralAgentToolResultMessage {
    if (
      "role" in message &&
      message.role === "toolResult" &&
      "toolCallId" in message &&
      "toolName" in message &&
      "isError" in message &&
      "content" in message
    ) {
      return message;
    }
    throw new Error("tool_result hooks must return a toolResult-shaped message");
  }

  private fromToolResultMessage(
    message: GeneralAgentToolResultMessage,
    fallback: Extract<TranscriptEntry, { type: "tool_result" }>,
  ): Extract<TranscriptEntry, { type: "tool_result" }> {
    return {
      type: "tool_result",
      callId: message.toolCallId ?? fallback.callId,
      toolName: message.toolName ?? fallback.toolName,
      output: message.content ?? fallback.output,
      details: message.details,
      isError: message.isError,
      timestamp: message.timestamp ?? fallback.timestamp,
    };
  }

  private async *emitBlockedHostedToolFallback(params: {
    callId: string;
    toolName: string;
    input: Record<string, unknown>;
    reason: string;
  }): AsyncIterable<GeneralAgentStreamEvent> {
    const errorResult = this.createErrorToolResult(params.reason);
    await this.appendTranscript({
      type: "tool_call",
      callId: params.callId,
      toolName: params.toolName,
      input: params.input,
      timestamp: Date.now(),
    });
    await this.runAfterToolCallHooks({
      toolCallId: params.callId,
      toolName: params.toolName,
      args: params.input,
      result: errorResult,
      isError: true,
    });
    await this.appendToolResultTranscript({
      type: "tool_result",
      callId: params.callId,
      toolName: params.toolName,
      output: errorResult.content,
      details: errorResult.details,
      isError: true,
      timestamp: Date.now(),
    });
    yield* this.emitEvents([
      {
        kind: "tool_call",
        callId: params.callId,
        toolName: params.toolName,
        input: params.input,
      },
      {
        kind: "tool_error",
        callId: params.callId,
        toolName: params.toolName,
        error: params.reason,
        details: errorResult.details,
      },
      {
        kind: "turn_complete",
        stopReason: "tool_use",
      },
    ]);
  }

  private createHostedToolSuccessResult(
    output: unknown,
    details: unknown = output,
  ): AgentToolResult<any> {
    return {
      content: [{ type: "text", text: typeof output === "string" ? output : JSON.stringify(output) }],
      details,
    };
  }

  private createHostedToolErrorResult(
    error: string,
    details: unknown = { error },
  ): AgentToolResult<any> {
    return {
      content: [{ type: "text", text: error }],
      details,
    };
  }

  private createErrorToolResult(message: string): AgentToolResult<any> {
    return {
      content: [{ type: "text", text: message }],
      details: { error: message },
    };
  }
}

function isCheckpointedToolName(toolName: string): boolean {
  return toolName === "write" || toolName === "edit" || toolName === "apply_patch";
}

function isToolResultFailure(result: GeneralAgentToolResult): boolean {
  if (
    result.details &&
    typeof result.details === "object" &&
    !Array.isArray(result.details) &&
    "error" in result.details
  ) {
    return true;
  }

  const firstText = result.content.find((content) => content.type === "text");
  return firstText?.text.startsWith("Error:") ?? false;
}

function createCheckpointTarget(
  absolutePath: string,
  workspaceDir: string,
): FileCheckpointTarget {
  return {
    absolutePath,
    displayPath: toWorkspaceDisplayPath(absolutePath, workspaceDir),
  };
}

function toWorkspaceDisplayPath(absolutePath: string, workspaceDir: string): string {
  const relativePath = path.relative(workspaceDir, absolutePath);
  if (!relativePath || relativePath === "") {
    return path.basename(absolutePath);
  }
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return absolutePath;
  }
  return relativePath;
}

function joinPresentTextSegments(left?: string, right?: string): string | undefined {
  const parts = [left, right].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function applyModelResolveOverride(
  modelRef: string,
  overrides: GeneralAgentBeforeModelResolveResult | GeneralAgentBeforeAgentStartResult,
): string {
  const [providerPart, ...rest] = modelRef.split("/");
  const hasProvider = rest.length > 0;
  const currentProvider = hasProvider ? providerPart : undefined;
  const currentModel = hasProvider ? rest.join("/") : providerPart;

  if (typeof overrides.modelOverride === "string" && overrides.modelOverride.includes("/")) {
    return overrides.modelOverride;
  }

  const nextProvider = overrides.providerOverride ?? currentProvider;
  const nextModel = overrides.modelOverride ?? currentModel;
  return nextProvider ? `${nextProvider}/${nextModel}` : nextModel;
}

function splitModelRef(
  modelRef: string,
  fallbackProvider: string,
): { provider: string; model: string } {
  const [providerPart, ...rest] = modelRef.split("/");
  if (rest.length === 0) {
    return {
      provider: fallbackProvider,
      model: providerPart,
    };
  }
  return {
    provider: providerPart,
    model: rest.join("/"),
  };
}

function inferAgentIdFromSessionKey(sessionKey?: string): string | undefined {
  if (!sessionKey) {
    return undefined;
  }
  const parts = sessionKey.split(":");
  if (parts[0] !== "agent" || parts.length < 2) {
    return undefined;
  }
  return parts[1] || undefined;
}
