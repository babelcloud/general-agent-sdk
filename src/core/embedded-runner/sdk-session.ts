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
import type { LLMProvider } from "../providers/types.js";
import type { ProviderContentBlock, ProviderMessage, ProviderToolDefinition } from "../providers/types.js";
import { AnthropicProvider } from "../providers/anthropic.js";
import { ALL_BUILTIN_TOOLS, getBuiltinToolByName } from "../tools/builtin/index.js";
import type { BuiltinTool } from "../tools/builtin/types.js";

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
  private currentQuery: OpenClawCurrentQueryLike | null = null;
  private lastCompactionAt = 0;
  private loggerSink: HostLoggerSink;

  // Agentic loop state
  private provider: LLMProvider | null;
  private builtinTools: BuiltinTool[];
  private conversationHistory: ProviderMessage[] = [];
  private maxTurns: number;

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
    this.maxTurns = options.maxTurns ?? 50;

    // Initialize provider
    if (options.providerConfig) {
      this.provider = new AnthropicProvider({
        apiKey: options.providerConfig.apiKey,
        baseURL: options.providerConfig.baseURL,
      });
    } else {
      this.provider = null;
    }

    // Resolve built-in tools
    const enabledNames = options.builtinTools;
    if (enabledNames) {
      this.builtinTools = enabledNames
        .map((name) => getBuiltinToolByName(name))
        .filter((t): t is BuiltinTool => t !== undefined);
    } else {
      this.builtinTools = [...ALL_BUILTIN_TOOLS];
    }
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

    if (this.stopRequested) {
      yield* this.emitEvents(createStopEvents("stop_requested"));
      return;
    }

    // Add user message to conversation history
    this.addUserMessage(input);

    // If no provider configured, fall back to mock mode
    if (!this.provider) {
      // In mock mode, detect hosted tools by text pattern matching
      const hostedTool = this.resolveHostedToolFromText(input);
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
          data: {
            callId: pending.callId,
            toolName: pending.toolName,
            sessionId: this.params.identity.sessionId,
          },
        });
        yield* this.emitEvents(createHostedToolSuspendEvents(pending));
        return;
      }

      const text = this.extractText(input);
      const reply = text ? `Acknowledged: ${text}` : "Acknowledged.";
      this.bumpUsage(input);
      this.conversationHistory.push({
        role: "assistant",
        content: [{ type: "text", text: reply }],
      });
      await this.appendTranscript({ type: "assistant", text: reply, timestamp: Date.now() });
      yield* this.emitEvents(
        createAssistantCompletionEvents({ text: reply, snapshot: this.usageSnapshot }),
      );
      return;
    }

    // Real agentic loop
    yield* this.runAgenticLoop();
  }

  injectMessage(_input: OpenClawTurnInput): boolean {
    return this.pendingHostedTool === null;
  }

  async *submitHostedToolResult(
    input: OpenClawHostedToolResultInput,
  ): AsyncIterable<OpenClawStreamEvent> {
    await this.restorePromise;
    const pending = this.assertPendingHostedTool(input.callId);
    const outputStr = typeof input.output === "string" ? input.output : JSON.stringify(input.output);

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

    // Add tool result to conversation and continue the loop
    this.conversationHistory.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: input.callId, content: outputStr }],
    });
    this.pendingHostedTool = null;

    if (this.provider) {
      yield* this.runAgenticLoop();
    } else {
      yield* this.emitEvents(
        createHostedToolResumeEvents({
          callId: input.callId,
          toolName: pending.toolName,
          output: input.output,
        }),
      );
    }
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

    this.conversationHistory.push({
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: input.callId,
        content: `Error: ${input.error}`,
        is_error: true,
      }],
    });
    this.pendingHostedTool = null;

    if (this.provider) {
      yield* this.runAgenticLoop();
    } else {
      yield* this.emitEvents(
        createHostedToolResumeEvents({
          callId: input.callId,
          toolName: pending.toolName,
          output: { error: input.error },
          isError: true,
        }),
      );
    }
  }

  requestStop(): void {
    this.stopRequested = true;
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

  // ---------------------------------------------------------------------------
  // Agentic loop — calls the LLM, executes tools, loops until end_turn
  // ---------------------------------------------------------------------------

  private async *runAgenticLoop(): AsyncGenerator<OpenClawStreamEvent> {
    const provider = this.provider!;
    let turns = 0;

    while (turns < this.maxTurns) {
      if (this.stopRequested) {
        yield* this.emitEvents(createStopEvents("stop_requested"));
        return;
      }

      turns++;

      const toolDefs = this.buildToolDefinitions();

      // Accumulate the assistant response from the streaming LLM call
      const assistantBlocks: ProviderContentBlock[] = [];
      let fullText = "";
      let stopReason: string = "end_turn";
      const toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];
      let currentToolId = "";
      let currentToolName = "";
      let currentToolJson = "";

      try {
        for await (const chunk of provider.stream({
          model: this.params.modelRef,
          systemPrompt: this.params.systemPrompt,
          messages: this.conversationHistory,
          tools: toolDefs,
        })) {
          switch (chunk.type) {
            case "text_delta":
              fullText += chunk.text ?? "";
              yield { kind: "assistant_delta", text: chunk.text ?? "" };
              break;

            case "thinking_delta":
              yield { kind: "reasoning_delta", text: chunk.text ?? "" };
              break;

            case "tool_use_start":
              currentToolId = chunk.toolUse?.id ?? randomUUID();
              currentToolName = chunk.toolUse?.name ?? "";
              currentToolJson = "";
              break;

            case "tool_use_delta":
              currentToolJson += chunk.partialJson ?? "";
              break;

            case "content_block_stop":
              if (currentToolId && currentToolName) {
                let parsedInput: Record<string, unknown> = {};
                try {
                  parsedInput = JSON.parse(currentToolJson || "{}");
                } catch {
                  parsedInput = {};
                }
                toolCalls.push({ id: currentToolId, name: currentToolName, input: parsedInput });
                assistantBlocks.push({
                  type: "tool_use",
                  id: currentToolId,
                  name: currentToolName,
                  input: parsedInput,
                });
                currentToolId = "";
                currentToolName = "";
                currentToolJson = "";
              }
              break;

            case "message_stop":
              stopReason = chunk.stopReason ?? "end_turn";
              if (chunk.usage) {
                this.updateUsage(chunk.usage.input_tokens, chunk.usage.output_tokens);
              }
              break;

            case "usage":
              if (chunk.usage) {
                this.updateUsage(chunk.usage.input_tokens, chunk.usage.output_tokens);
              }
              break;
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.loggerSink.emitError({
          category: "provider_debug",
          message: `LLM error: ${msg}`,
          data: { error: msg, sessionId: this.params.identity.sessionId },
        });
        yield { kind: "turn_complete", stopReason: `error: ${msg}` };
        return;
      }

      // Build assistant message for conversation history
      if (fullText) {
        assistantBlocks.unshift({ type: "text", text: fullText });
      }
      this.conversationHistory.push({ role: "assistant", content: assistantBlocks });

      if (fullText) {
        await this.appendTranscript({ type: "assistant", text: fullText, timestamp: Date.now() });
      }

      // No tool calls → turn is complete
      if (toolCalls.length === 0 || stopReason === "end_turn") {
        if (this.usageSnapshot) {
          yield { kind: "usage_snapshot", snapshot: this.usageSnapshot };
        }
        yield { kind: "turn_complete", stopReason: "end_turn" };
        return;
      }

      // Execute each tool call
      const toolResults: ProviderContentBlock[] = [];
      for (const tc of toolCalls) {
        await this.appendTranscript({
          type: "tool_call",
          callId: tc.id,
          toolName: tc.name,
          input: tc.input,
          timestamp: Date.now(),
        });
        yield { kind: "tool_call", callId: tc.id, toolName: tc.name, input: tc.input };

        // Hosted tool → suspend execution for the host
        const hostedTool = this.hostedTools.find(
          (h) => h.name === tc.name && isToolAllowedInEmbeddedMode(h.name),
        );
        if (hostedTool) {
          this.pendingHostedTool = { callId: tc.id, toolName: tc.name, input: tc.input };
          yield { kind: "hosted_tool_call", callId: tc.id, toolName: tc.name, input: tc.input };
          return; // host resumes via submitHostedToolResult
        }

        // Built-in tool → execute locally
        const builtin = this.builtinTools.find((bt) => bt.definition.name === tc.name);
        if (builtin) {
          this.loggerSink.emitInfo({
            category: "tool_call",
            message: tc.name,
            data: { callId: tc.id, toolName: tc.name, input: tc.input },
          });
          const result = await builtin.execute(tc.input, { cwd: this.options.workspaceDir });
          const resultStr = result.content;
          await this.appendTranscript({
            type: "tool_result",
            callId: tc.id,
            toolName: tc.name,
            output: resultStr,
            isError: result.isError,
            timestamp: Date.now(),
          });
          this.loggerSink.emitInfo({
            category: "tool_result",
            message: tc.name,
            data: { callId: tc.id, output: resultStr.slice(0, 200) },
          });
          yield { kind: "tool_result", callId: tc.id, toolName: tc.name, output: resultStr, isError: result.isError };
          toolResults.push({
            type: "tool_result",
            tool_use_id: tc.id,
            content: resultStr,
            is_error: result.isError,
          });
        } else {
          const errMsg = `Unknown tool: ${tc.name}`;
          yield { kind: "tool_error", callId: tc.id, toolName: tc.name, error: errMsg };
          toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: errMsg, is_error: true });
        }
      }

      // Feed tool results back into conversation and loop
      this.conversationHistory.push({ role: "user", content: toolResults });
    }

    // Max turns reached
    if (this.usageSnapshot) {
      yield { kind: "usage_snapshot", snapshot: this.usageSnapshot };
    }
    yield { kind: "turn_complete", stopReason: "max_turns" };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private buildToolDefinitions(): ProviderToolDefinition[] {
    const defs: ProviderToolDefinition[] = [];
    for (const bt of this.builtinTools) {
      defs.push(bt.definition);
    }
    for (const ht of this.hostedTools) {
      if (isToolAllowedInEmbeddedMode(ht.name)) {
        defs.push({ name: ht.name, description: ht.description, input_schema: ht.inputSchema });
      }
    }
    return defs;
  }

  private addUserMessage(input: OpenClawTurnInput): void {
    const content: ProviderContentBlock[] = input.content.map((block) => {
      if (block.type === "text") {
        return { type: "text", text: block.text };
      }
      if (block.type === "image") {
        return {
          type: "image",
          source: { type: "base64" as const, media_type: block.mimeType, data: block.data },
        };
      }
      if (block.type === "tool_result") {
        const outputStr = typeof block.output === "string" ? block.output : JSON.stringify(block.output);
        return { type: "tool_result", tool_use_id: block.callId, content: outputStr, is_error: block.isError };
      }
      return { type: "text", text: "" };
    });
    this.conversationHistory.push({ role: "user", content });
  }

  private updateUsage(inputTokens: number, outputTokens: number): void {
    const prev = this.usageSnapshot;
    const usedInputTokens = (prev?.usedInputTokens ?? 0) + inputTokens + outputTokens;
    const contextWindow = prev?.contextWindow ?? 200_000;
    this.usageSnapshot = {
      usedInputTokens,
      contextWindow,
      usedPct: Number(((usedInputTokens / contextWindow) * 100).toFixed(4)),
      capturedAtMs: Date.now(),
    };
  }

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

  private resolveHostedToolFromText(input: OpenClawTurnInput): OpenClawHostedToolDefinition | null {
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
      if (text.includes(tool.name.toLowerCase())) {
        return tool;
      }
    }
    return null;
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

  private extractText(input: OpenClawTurnInput): string {
    return input.content
      .filter((entry): entry is Extract<OpenClawTurnInput["content"][number], { type: "text" }> =>
        entry.type === "text",
      )
      .map((entry) => entry.text)
      .join("\n");
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
