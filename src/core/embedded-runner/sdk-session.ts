import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawStreamEvent } from "../../public/events.js";
import type {
  OpenClawHostedToolDefinition,
  OpenClawHostedToolErrorInput,
  OpenClawHostedToolResultInput,
} from "../../public/host-tools.js";
import type { OpenClawSessionStoreAdapter } from "../../public/persistence.js";
import type { OpenClawAgentSdkOptions } from "../../public/sdk.js";
import type { OpenClawAgentSession } from "../../public/session.js";
import type {
  OpenClawCompactionOptions,
  OpenClawCurrentQueryLike,
  OpenClawSessionParams,
  OpenClawTurnInput,
  OpenClawUsageSnapshot,
} from "../../public/types.js";
import {
  createAssistantCompletionEvents,
  createHostedToolResumeEvents,
  createHostedToolSuspendEvents,
  createStopEvents,
} from "../normalization/upstream-events.js";
import { HostLoggerSink } from "../logging/host-logger.js";
import { resolveHostSessionFile } from "../sessions/session-store.js";
import { isToolAllowedInEmbeddedMode } from "../tools/tool-policy.js";
import { assembleLocalTools } from "../../tools/tool-assembly.js";
import type { OpenClawTool } from "../../tools/tool-interface.js";
import type { AgentContext, AgentTool, AgentEvent, AgentMessage } from "../../loop/agent-types.js";
import { agentLoop } from "../../loop/agent-loop.js";
import type { Message, UserMessage } from "../../providers/anthropic-types.js";
import { adaptAgentEventToStreamEvents } from "./agent-event-adapter.js";
import { HostedToolBridge } from "./hosted-tool-bridge.js";
import { modelFromRef } from "./model-from-ref.js";

type PendingHostedToolCall = {
  callId: string;
  toolName: string;
  input: Record<string, unknown>;
};

type TranscriptEntry =
  | { type: "system_prompt"; prompt: string; modelRef: string; timestamp: number }
  | { type: "message"; role: string; content: OpenClawTurnInput["content"]; timestamp: number }
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
      isError?: boolean;
      timestamp: number;
    }
  | { type: "assistant"; text: string; timestamp: number };

export class OpenClawSdkSession implements OpenClawAgentSession {
  private params: OpenClawSessionParams;
  private readonly sessionStore: OpenClawSessionStoreAdapter;
  private readonly hostedTools: OpenClawHostedToolDefinition[];
  private readonly restorePromise: Promise<void>;
  private readonly dynamicMcpServers: Record<string, Record<string, unknown>> = {};
  private usageSnapshot: OpenClawUsageSnapshot | null = null;
  private transcriptPath: string | null;
  private pendingHostedTool: PendingHostedToolCall | null = null;
  private stopRequested = false;
  private abortController: AbortController | null = null;
  private currentQuery: OpenClawCurrentQueryLike | null = null;
  private lastCompactionAt = 0;
  private loggerSink: HostLoggerSink;
  private readonly localTools: OpenClawTool[];
  private readonly hostedToolBridge = new HostedToolBridge();
  // Persistent agent context across turns (for the vendored loop)
  private agentMessages: AgentMessage[] = [];

  constructor(
    private readonly options: OpenClawAgentSdkOptions,
    params: OpenClawSessionParams,
  ) {
    this.params = params;
    this.sessionStore = options.sessionStore;
    this.hostedTools = options.hostedTools ?? [];
    this.transcriptPath = params.sessionFile;
    this.loggerSink = new HostLoggerSink(options.logger, params.rawEventLogPath);
    this.restorePromise = this.restoreStoredState();
    this.localTools = assembleLocalTools(options.workspaceDir);
  }

  reconfigure(params: OpenClawSessionParams): void {
    this.params = params;
    this.transcriptPath = params.sessionFile;
    this.loggerSink = new HostLoggerSink(this.options.logger, params.rawEventLogPath);
  }

  async *streamTurn(input: OpenClawTurnInput): AsyncIterable<OpenClawStreamEvent> {
    await this.restorePromise;
    this.transcriptPath = await resolveHostSessionFile(
      this.sessionStore,
      this.params.identity,
      this.params.sessionFile,
    );
    await this.ensureTranscriptPath();
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

    // Get API key — only use explicitly configured keys
    const apiKey = this.params.anthropicApiKey ?? this.options.anthropicApiKey;
    if (!apiKey) {
      // Fallback to stub behavior for backwards compatibility
      const hostedTool = this.resolveHostedTool(input);
      if (hostedTool) {
        const pending: PendingHostedToolCall = {
          callId: randomUUID(),
          toolName: hostedTool.name,
          input: {},
        };
        this.pendingHostedTool = pending;
        await this.appendTranscript({
          type: "tool_call",
          callId: pending.callId,
          toolName: pending.toolName,
          input: pending.input,
          timestamp: Date.now(),
        });
        this.loggerSink.emitInfo({
          category: "tool_call",
          message: pending.toolName,
          data: { callId: pending.callId, toolName: pending.toolName, sessionId: this.params.identity.sessionId },
        });
        yield* this.emitEvents(createHostedToolSuspendEvents(pending));
        return;
      }

      const text = this.extractText(input);
      const reply = text ? `Acknowledged: ${text}` : "Acknowledged.";
      await this.appendTranscript({ type: "assistant", text: reply, timestamp: Date.now() });
      yield* this.emitEvents(createAssistantCompletionEvents({ text: reply, snapshot: this.usageSnapshot }));
      return;
    }

    // --- Real Anthropic path using vendored agent loop ---
    yield* this.runWithVendoredLoop(input, apiKey);
  }

  injectMessage(_input: OpenClawTurnInput): boolean {
    return this.pendingHostedTool === null;
  }

  async *submitHostedToolResult(
    input: OpenClawHostedToolResultInput,
  ): AsyncIterable<OpenClawStreamEvent> {
    await this.restorePromise;
    const pending = this.assertPendingHostedTool(input.callId);
    await this.appendTranscript({
      type: "tool_result",
      callId: input.callId,
      toolName: pending.toolName,
      output: input.output,
      timestamp: Date.now(),
    });
    this.loggerSink.emitInfo({
      category: "tool_result",
      message: pending.toolName,
      data: {
        callId: input.callId,
        toolName: pending.toolName,
        output: input.output,
        sessionId: this.params.identity.sessionId,
      },
    });
    this.pendingHostedTool = null;

    // If the bridge has a pending call, resolve it so the loop continues
    if (this.hostedToolBridge.hasPending()) {
      this.hostedToolBridge.submitResult(input.callId, input.output);
    }

    yield* this.emitEvents(
      createHostedToolResumeEvents({
        callId: input.callId,
        toolName: pending.toolName,
        output: input.output,
      }),
    );
  }

  async *submitHostedToolError(
    input: OpenClawHostedToolErrorInput,
  ): AsyncIterable<OpenClawStreamEvent> {
    await this.restorePromise;
    const pending = this.assertPendingHostedTool(input.callId);
    await this.appendTranscript({
      type: "tool_result",
      callId: input.callId,
      toolName: pending.toolName,
      output: { error: input.error },
      isError: true,
      timestamp: Date.now(),
    });
    this.loggerSink.emitError({
      category: "tool_result",
      message: pending.toolName,
      data: {
        callId: input.callId,
        toolName: pending.toolName,
        error: input.error,
        sessionId: this.params.identity.sessionId,
      },
    });
    this.pendingHostedTool = null;

    if (this.hostedToolBridge.hasPending()) {
      this.hostedToolBridge.submitError(input.callId, input.error);
    }

    yield* this.emitEvents(
      createHostedToolResumeEvents({
        callId: input.callId,
        toolName: pending.toolName,
        output: { error: input.error },
        isError: true,
      }),
    );
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

  async requestCompaction(): Promise<void> {
    this.lastCompactionAt = Date.now();
  }

  async maybeCompactByTokens(options?: OpenClawCompactionOptions): Promise<void> {
    const snapshot = this.usageSnapshot;
    if (!snapshot) return;
    const threshold = options?.usedPctThreshold ?? 85;
    const cooldownMs = options?.cooldownMs ?? 60_000;
    const now = Date.now();
    if (snapshot.usedPct >= threshold && now - this.lastCompactionAt >= cooldownMs) {
      this.lastCompactionAt = now;
    }
  }

  getSessionId(): string {
    return this.params.identity.sessionId;
  }

  getTranscriptPath(): string | null {
    return this.transcriptPath;
  }

  getUsageSnapshot(): OpenClawUsageSnapshot | null {
    return this.usageSnapshot;
  }

  getCurrentQuery(): OpenClawCurrentQueryLike | null {
    return this.currentQuery;
  }

  setDynamicMcpServers(servers: Record<string, Record<string, unknown>>): void {
    for (const key of Object.keys(this.dynamicMcpServers)) {
      delete this.dynamicMcpServers[key];
    }
    Object.assign(this.dynamicMcpServers, structuredClone(servers));
  }

  getDynamicMcpServers(): Record<string, Record<string, unknown>> {
    return structuredClone(this.dynamicMcpServers);
  }

  closeInput(): void {}

  // --- Vendored loop integration ---

  private async *runWithVendoredLoop(
    input: OpenClawTurnInput,
    apiKey: string,
  ): AsyncIterable<OpenClawStreamEvent> {
    const model = modelFromRef(this.params.modelRef);

    // Build agent tools: local tools (wrapped) + hosted tools (bridged)
    const agentTools: AgentTool[] = [];

    for (const localTool of this.localTools) {
      agentTools.push(this.wrapLocalToolAsAgentTool(localTool));
    }

    for (const hostedTool of this.hostedTools) {
      if (isToolAllowedInEmbeddedMode(hostedTool.name)) {
        agentTools.push(this.hostedToolBridge.createAgentTool(hostedTool));
      }
    }

    // Build user message
    const userMessage: UserMessage = {
      role: "user",
      content: this.buildUserContent(input),
      timestamp: Date.now(),
    };

    // Build agent context
    const context: AgentContext = {
      systemPrompt: this.params.systemPrompt,
      messages: this.agentMessages,
      tools: agentTools,
    };

    // Create abort controller for signal propagation
    this.abortController = new AbortController();
    if (this.stopRequested) {
      this.abortController.abort();
    }

    // Run the vendored loop
    const eventStream = agentLoop(
      [userMessage],
      context,
      {
        model,
        apiKey,
        convertToLlm: (messages: AgentMessage[]) => messages as Message[],
        reasoning: model.reasoning ? "high" : undefined,
      },
      this.abortController.signal,
    );

    // Iterate events, translate, and yield
    let hostedToolSuspended = false;
    for await (const event of eventStream) {
      // Transcript logging for specific events
      if (event.type === "tool_execution_start") {
        await this.appendTranscript({
          type: "tool_call",
          callId: event.toolCallId,
          toolName: event.toolName,
          input: event.args ?? {},
          timestamp: Date.now(),
        });
      }
      if (event.type === "tool_execution_end") {
        await this.appendTranscript({
          type: "tool_result",
          callId: event.toolCallId,
          toolName: event.toolName,
          output: event.result?.content ?? [],
          isError: event.isError,
          timestamp: Date.now(),
        });
      }
      if (event.type === "message_end") {
        const msg = event.message;
        if (msg && "role" in msg && msg.role === "assistant" && "content" in msg) {
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
          // Update usage from assistant message
          if ("usage" in msg && (msg as any).usage) {
            const usage = (msg as any).usage;
            this.usageSnapshot = {
              usedInputTokens: usage.input ?? 0,
              contextWindow: 200_000,
              usedPct: Number((((usage.input ?? 0) / 200_000) * 100).toFixed(4)),
              capturedAtMs: Date.now(),
            };
          }
        }
      }

      // Check if a hosted tool was just called (bridge has a pending call)
      if (event.type === "tool_execution_start" && this.hostedToolBridge.hasPending()) {
        // The bridge's execute() is now blocking the loop.
        // We need to suspend and let the host provide the result.
        const pending = this.hostedToolBridge.getPending()!;
        this.pendingHostedTool = {
          callId: pending.callId,
          toolName: pending.toolName,
          input: pending.input,
        };
        yield* this.emitEvents(createHostedToolSuspendEvents(this.pendingHostedTool));
        hostedToolSuspended = true;
        // Don't return — the loop is blocked on the bridge promise.
        // When submitHostedToolResult is called, it resolves the promise,
        // and the loop will continue producing events.
        // But we can't yield from this generator anymore after returning...
        // So we need to break and let the host resume via submitHostedToolResult.
        break;
      }

      // Translate and emit
      const streamEvents = adaptAgentEventToStreamEvents(event);
      for (const streamEvent of streamEvents) {
        this.loggerSink.emitRaw(streamEvent as Record<string, unknown>);
        yield streamEvent;
      }
    }

    if (!hostedToolSuspended) {
      // Save updated messages from the loop context
      this.agentMessages = context.messages;
    }

    this.abortController = null;
  }

  /**
   * Wrap an OpenClawTool as an AgentTool for the vendored loop.
   */
  private wrapLocalToolAsAgentTool(tool: OpenClawTool): AgentTool {
    return {
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: async (toolCallId: string, params: any, signal?: AbortSignal) => {
        const result = await tool.execute(toolCallId, params, signal);
        // Convert OpenClawToolResult → AgentToolResult
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
          details: {},
        };
      },
    };
  }

  private buildUserContent(input: OpenClawTurnInput): string | Array<any> {
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
    if (!stored) return;
    if (stored.transcriptPath) this.transcriptPath = stored.transcriptPath;
    if (stored.usageSnapshot) this.usageSnapshot = stored.usageSnapshot;
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

  private resolveHostedTool(input: OpenClawTurnInput): OpenClawHostedToolDefinition | null {
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

  private extractText(input: OpenClawTurnInput): string {
    return input.content
      .filter((entry): entry is Extract<OpenClawTurnInput["content"][number], { type: "text" }> =>
        entry.type === "text",
      )
      .map((entry) => entry.text)
      .join("\n");
  }

  private bumpUsage(input: OpenClawTurnInput): void {
    const approximateInputTokens = Math.max(1, Math.ceil(this.extractText(input).length / 4));
    const previous = this.usageSnapshot?.usedInputTokens ?? 0;
    const contextWindow = this.usageSnapshot?.contextWindow ?? 200_000;
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
    await this.ensureTranscriptPath();
    await fs.appendFile(this.transcriptPath!, JSON.stringify(entry) + "\n", "utf-8");
    await this.sessionStore.save(this.params.identity, {
      sessionId: this.params.identity.sessionId,
      sessionKey: this.params.identity.sessionKey,
      usageSnapshot: this.usageSnapshot ?? undefined,
      transcriptPath: this.transcriptPath,
    });
  }

  private async *emitEvents(
    events: Iterable<OpenClawStreamEvent>,
  ): AsyncIterable<OpenClawStreamEvent> {
    for (const event of events) {
      this.loggerSink.emitRaw(event as Record<string, unknown>);
      yield event;
    }
  }
}
