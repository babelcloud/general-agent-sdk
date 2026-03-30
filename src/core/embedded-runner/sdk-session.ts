import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
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
import type { OpenClawTool } from "../../tools/tool-interface.js";
import { toAnthropicToolDef } from "../../tools/tool-interface.js";
import { assembleLocalTools } from "../../tools/tool-assembly.js";

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
  private readonly localTools: OpenClawTool[];
  private readonly conversationHistory: Array<{ role: string; content: any }> = [];

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

    // Get API key — only use env var if explicitly opted in via options
    const apiKey = this.params.anthropicApiKey ?? this.options.anthropicApiKey;
    if (!apiKey) {
      // Fallback to stub behavior for backwards compatibility
      // Check for hosted tool by keyword matching
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

    // Build Anthropic messages from input
    this.conversationHistory.push({
      role: "user",
      content: this.buildAnthropicUserContent(input),
    });

    // Build tools list for Anthropic
    const anthropicTools = this.localTools.map(toAnthropicToolDef);
    for (const hostedTool of this.hostedTools) {
      if (isToolAllowedInEmbeddedMode(hostedTool.name)) {
        anthropicTools.push({
          name: hostedTool.name,
          description: hostedTool.description ?? `Hosted tool: ${hostedTool.name}`,
          input_schema: (hostedTool.inputSchema ?? { type: "object", properties: {} }) as any,
        });
      }
    }

    // Create Anthropic client
    const client = new Anthropic({ apiKey });

    // Agentic loop: call Anthropic, execute local tools, loop
    yield* this.runAgenticLoop(client, anthropicTools);
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
    if (!snapshot) {
      return;
    }

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

  private async restoreStoredState(): Promise<void> {
    const stored = await this.sessionStore.load(this.params.identity);
    if (!stored) {
      return;
    }

    if (stored.transcriptPath) {
      this.transcriptPath = stored.transcriptPath;
    }
    if (stored.usageSnapshot) {
      this.usageSnapshot = stored.usageSnapshot;
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

  private resolveHostedTool(input: OpenClawTurnInput): OpenClawHostedToolDefinition | null {
    const text = this.extractText(input).toLowerCase();
    for (const tool of this.hostedTools) {
      if (!isToolAllowedInEmbeddedMode(tool.name)) {
        this.loggerSink.emitWarn({
          category: "system",
          message: `blocked embedded tool: ${tool.name}`,
          data: {
            toolName: tool.name,
            sessionId: this.params.identity.sessionId,
          },
        });
        continue;
      }

      if (text.includes(tool.name.toLowerCase())) {
        return tool;
      }
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

  private buildAnthropicUserContent(input: OpenClawTurnInput): string | Array<any> {
    const textParts = input.content.filter((c) => c.type === "text") as Array<{ type: "text"; text: string }>;
    const imageParts = input.content.filter((c) => c.type === "image");

    if (imageParts.length === 0) {
      return textParts.map((p) => p.text).join("\n");
    }

    const blocks: any[] = [];
    for (const part of input.content) {
      if (part.type === "text") {
        blocks.push({ type: "text", text: part.text });
      } else if (part.type === "image") {
        blocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: part.mimeType,
            data: part.data,
          },
        });
      }
    }
    return blocks;
  }

  private async *runAgenticLoop(
    client: Anthropic,
    anthropicTools: Anthropic.Messages.Tool[],
  ): AsyncIterable<OpenClawStreamEvent> {
    const maxTurns = 50;
    let turn = 0;

    while (turn < maxTurns) {
      turn++;

      if (this.stopRequested) {
        yield* this.emitEvents(createStopEvents("stop_requested"));
        return;
      }

      // Call Anthropic API
      let response: Anthropic.Messages.Message;
      try {
        response = await client.messages.create({
          model: this.params.modelRef,
          max_tokens: 16384,
          system: this.params.systemPrompt,
          messages: this.conversationHistory as any,
          tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        yield* this.emitEvents(createAssistantCompletionEvents({
          text: `Error calling Anthropic API: ${errMsg}`,
          snapshot: this.usageSnapshot,
        }));
        return;
      }

      // Update usage
      this.usageSnapshot = {
        usedInputTokens: response.usage.input_tokens,
        contextWindow: 200_000,
        usedPct: Number(((response.usage.input_tokens / 200_000) * 100).toFixed(4)),
        capturedAtMs: Date.now(),
      };

      // Process response content
      const assistantContent: any[] = [];
      let textParts: string[] = [];
      const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

      for (const block of response.content) {
        if (block.type === "text") {
          textParts.push(block.text);
          assistantContent.push(block);
        } else if (block.type === "tool_use") {
          toolCalls.push({ id: block.id, name: block.name, input: block.input as Record<string, unknown> });
          assistantContent.push(block);
        }
      }

      // Add assistant message to history
      this.conversationHistory.push({
        role: "assistant",
        content: assistantContent,
      });

      // Emit text if present
      const fullText = textParts.join("\n");
      if (fullText && toolCalls.length === 0) {
        await this.appendTranscript({ type: "assistant", text: fullText, timestamp: Date.now() });
        yield* this.emitEvents(createAssistantCompletionEvents({
          text: fullText,
          snapshot: this.usageSnapshot,
        }));
        return;
      }

      if (fullText) {
        await this.appendTranscript({ type: "assistant", text: fullText, timestamp: Date.now() });
      }

      if (toolCalls.length === 0) {
        // No text and no tool calls — done
        yield* this.emitEvents(createAssistantCompletionEvents({
          text: fullText || "(empty response)",
          snapshot: this.usageSnapshot,
        }));
        return;
      }

      // Process tool calls
      const toolResultContents: any[] = [];
      for (const tc of toolCalls) {
        await this.appendTranscript({
          type: "tool_call",
          callId: tc.id,
          toolName: tc.name,
          input: tc.input,
          timestamp: Date.now(),
        });

        // Check if this is a hosted tool
        const hostedTool = this.hostedTools.find(
          (ht) => ht.name === tc.name && isToolAllowedInEmbeddedMode(ht.name),
        );
        if (hostedTool) {
          // Suspend for hosted tool
          this.pendingHostedTool = {
            callId: tc.id,
            toolName: tc.name,
            input: tc.input,
          };
          this.loggerSink.emitInfo({
            category: "tool_call",
            message: tc.name,
            data: { callId: tc.id, toolName: tc.name, sessionId: this.params.identity.sessionId },
          });
          yield* this.emitEvents(createHostedToolSuspendEvents(this.pendingHostedTool));
          return; // Suspend — host will call submitHostedToolResult to resume
        }

        // Execute local tool
        const localTool = this.localTools.find((t) => t.name === tc.name);
        if (localTool) {
          this.loggerSink.emitInfo({
            category: "tool_call",
            message: tc.name,
            data: { callId: tc.id, toolName: tc.name, input: tc.input },
          });

          try {
            const result = await localTool.execute(tc.id, tc.input);
            const resultContent = result.content.map((c) => {
              if (c.type === "text") return { type: "text" as const, text: c.text };
              if (c.type === "image") {
                return {
                  type: "image" as const,
                  source: c.source,
                };
              }
              return c;
            });

            await this.appendTranscript({
              type: "tool_result",
              callId: tc.id,
              toolName: tc.name,
              output: resultContent,
              timestamp: Date.now(),
            });

            toolResultContents.push({
              type: "tool_result",
              tool_use_id: tc.id,
              content: resultContent,
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            await this.appendTranscript({
              type: "tool_result",
              callId: tc.id,
              toolName: tc.name,
              output: errMsg,
              isError: true,
              timestamp: Date.now(),
            });
            toolResultContents.push({
              type: "tool_result",
              tool_use_id: tc.id,
              content: errMsg,
              is_error: true,
            });
          }
        } else {
          // Unknown tool
          toolResultContents.push({
            type: "tool_result",
            tool_use_id: tc.id,
            content: `Error: Unknown tool: ${tc.name}`,
            is_error: true,
          });
        }
      }

      // Add tool results to conversation and loop
      this.conversationHistory.push({
        role: "user",
        content: toolResultContents,
      });
    }

    // Max turns exceeded
    yield* this.emitEvents(createAssistantCompletionEvents({
      text: "[Max turns exceeded]",
      snapshot: this.usageSnapshot,
    }));
  }
}
