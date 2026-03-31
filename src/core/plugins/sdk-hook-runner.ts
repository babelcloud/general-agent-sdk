import type {
  GeneralAgentAfterCompactionEvent,
  GeneralAgentAfterToolCallEvent,
  GeneralAgentAgentHookContext,
  GeneralAgentAgentEndEvent,
  GeneralAgentBeforeAgentStartEvent,
  GeneralAgentBeforeAgentStartResult,
  GeneralAgentBeforeCompactionEvent,
  GeneralAgentBeforeDispatchContext,
  GeneralAgentBeforeDispatchEvent,
  GeneralAgentBeforeDispatchResult,
  GeneralAgentBeforeMessageWriteEvent,
  GeneralAgentBeforeMessageWriteResult,
  GeneralAgentBeforeModelResolveEvent,
  GeneralAgentBeforeModelResolveResult,
  GeneralAgentBeforePromptBuildEvent,
  GeneralAgentBeforePromptBuildResult,
  GeneralAgentBeforeResetEvent,
  GeneralAgentBeforeToolCallEvent,
  GeneralAgentBeforeToolCallResult,
  GeneralAgentGatewayHookContext,
  GeneralAgentGatewayStartEvent,
  GeneralAgentGatewayStopEvent,
  GeneralAgentHookDispatchRequest,
  GeneralAgentHookDispatchResult,
  GeneralAgentHookHandlerMap,
  GeneralAgentHookName,
  GeneralAgentHookRegistration,
  GeneralAgentInboundClaimContext,
  GeneralAgentInboundClaimEvent,
  GeneralAgentInboundClaimResult,
  GeneralAgentLlmInputEvent,
  GeneralAgentLlmOutputEvent,
  GeneralAgentMessageHookContext,
  GeneralAgentMessageReceivedEvent,
  GeneralAgentMessageSendingEvent,
  GeneralAgentMessageSendingResult,
  GeneralAgentMessageSentEvent,
  GeneralAgentSessionEndEvent,
  GeneralAgentSessionHookContext,
  GeneralAgentSessionStartEvent,
  GeneralAgentSubagentDeliveryTargetEvent,
  GeneralAgentSubagentDeliveryTargetResult,
  GeneralAgentSubagentEndedEvent,
  GeneralAgentSubagentHookContext,
  GeneralAgentSubagentSpawnedEvent,
  GeneralAgentSubagentSpawningEvent,
  GeneralAgentSubagentSpawningResult,
  GeneralAgentToolHookContext,
  GeneralAgentToolResultPersistContext,
  GeneralAgentToolResultPersistEvent,
  GeneralAgentToolResultPersistResult,
} from "../../public/hooks.js";
import type { GeneralAgentHostLogger } from "../../public/types.js";

type HookHandler<TName extends GeneralAgentHookName> = Extract<
  GeneralAgentHookRegistration,
  { hookName: TName }
>["handler"];

type ModifyingHookPolicy<K extends GeneralAgentHookName, TResult> = {
  mergeResults?: (accumulated: TResult | undefined, next: TResult) => TResult;
  shouldStop?: (result: TResult) => boolean;
  terminalLabel?: string;
  onTerminal?: (params: { hookName: K; pluginId: string; result: TResult }) => void;
};

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(
    value &&
      (typeof value === "object" || typeof value === "function") &&
      "then" in value &&
      typeof (value as { then?: unknown }).then === "function",
  );
}

function concatOptionalTextSegments(
  left?: string,
  right?: string,
): string | undefined {
  const parts = [left, right].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export class GeneralAgentHookRunner {
  private readonly hooks: GeneralAgentHookRegistration[];

  constructor(
    hooks: GeneralAgentHookRegistration[],
    private readonly logger: GeneralAgentHostLogger,
  ) {
    this.hooks = [...hooks].sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));
  }

  hasHooks(hookName?: GeneralAgentHookName): boolean {
    if (!hookName) {
      return this.hooks.length > 0;
    }
    return this.hooks.some((hook) => hook.hookName === hookName);
  }

  async runBeforeModelResolve(
    event: GeneralAgentBeforeModelResolveEvent,
    ctx: GeneralAgentAgentHookContext,
  ): Promise<GeneralAgentBeforeModelResolveResult | undefined> {
    return this.runModifyingHook("before_model_resolve", event, ctx, {
      mergeResults: (acc, next) => ({
        modelOverride: acc?.modelOverride ?? next.modelOverride,
        providerOverride: acc?.providerOverride ?? next.providerOverride,
      }),
    });
  }

  async runBeforePromptBuild(
    event: GeneralAgentBeforePromptBuildEvent,
    ctx: GeneralAgentAgentHookContext,
  ): Promise<GeneralAgentBeforePromptBuildResult | undefined> {
    return this.runModifyingHook("before_prompt_build", event, ctx, {
      mergeResults: (acc, next) => ({
        systemPrompt: next.systemPrompt ?? acc?.systemPrompt,
        prependContext: concatOptionalTextSegments(acc?.prependContext, next.prependContext),
        prependSystemContext: concatOptionalTextSegments(
          acc?.prependSystemContext,
          next.prependSystemContext,
        ),
        appendSystemContext: concatOptionalTextSegments(
          acc?.appendSystemContext,
          next.appendSystemContext,
        ),
      }),
    });
  }

  async runBeforeAgentStart(
    event: GeneralAgentBeforeAgentStartEvent,
    ctx: GeneralAgentAgentHookContext,
  ): Promise<GeneralAgentBeforeAgentStartResult | undefined> {
    return this.runModifyingHook("before_agent_start", event, ctx, {
      mergeResults: (acc, next) => ({
        modelOverride: acc?.modelOverride ?? next.modelOverride,
        providerOverride: acc?.providerOverride ?? next.providerOverride,
        systemPrompt: next.systemPrompt ?? acc?.systemPrompt,
        prependContext: concatOptionalTextSegments(acc?.prependContext, next.prependContext),
        prependSystemContext: concatOptionalTextSegments(
          acc?.prependSystemContext,
          next.prependSystemContext,
        ),
        appendSystemContext: concatOptionalTextSegments(
          acc?.appendSystemContext,
          next.appendSystemContext,
        ),
      }),
    });
  }

  async runLlmInput(
    event: GeneralAgentLlmInputEvent,
    ctx: GeneralAgentAgentHookContext,
  ): Promise<void> {
    await this.runVoidHook("llm_input", event, ctx);
  }

  async runLlmOutput(
    event: GeneralAgentLlmOutputEvent,
    ctx: GeneralAgentAgentHookContext,
  ): Promise<void> {
    await this.runVoidHook("llm_output", event, ctx);
  }

  async runAgentEnd(
    event: GeneralAgentAgentEndEvent,
    ctx: GeneralAgentAgentHookContext,
  ): Promise<void> {
    await this.runVoidHook("agent_end", event, ctx);
  }

  async runBeforeCompaction(
    event: GeneralAgentBeforeCompactionEvent,
    ctx: GeneralAgentAgentHookContext,
  ): Promise<void> {
    await this.runVoidHook("before_compaction", event, ctx);
  }

  async runAfterCompaction(
    event: GeneralAgentAfterCompactionEvent,
    ctx: GeneralAgentAgentHookContext,
  ): Promise<void> {
    await this.runVoidHook("after_compaction", event, ctx);
  }

  async runBeforeReset(
    event: GeneralAgentBeforeResetEvent,
    ctx: GeneralAgentAgentHookContext,
  ): Promise<void> {
    await this.runVoidHook("before_reset", event, ctx);
  }

  async runInboundClaim(
    event: GeneralAgentInboundClaimEvent,
    ctx: GeneralAgentInboundClaimContext,
  ): Promise<GeneralAgentInboundClaimResult | undefined> {
    return this.runClaimingHook("inbound_claim", event, ctx);
  }

  async runMessageReceived(
    event: GeneralAgentMessageReceivedEvent,
    ctx: GeneralAgentMessageHookContext,
  ): Promise<void> {
    await this.runVoidHook("message_received", event, ctx);
  }

  async runBeforeDispatch(
    event: GeneralAgentBeforeDispatchEvent,
    ctx: GeneralAgentBeforeDispatchContext,
  ): Promise<GeneralAgentBeforeDispatchResult | undefined> {
    return this.runClaimingHook("before_dispatch", event, ctx);
  }

  async runMessageSending(
    event: GeneralAgentMessageSendingEvent,
    ctx: GeneralAgentMessageHookContext,
  ): Promise<GeneralAgentMessageSendingResult | undefined> {
    return this.runModifyingHook("message_sending", event, ctx, {
      mergeResults: (acc, next) => {
        if (acc?.cancel === true) {
          return acc;
        }
        return {
          content: next.content ?? acc?.content,
          cancel: acc?.cancel || next.cancel ? true : undefined,
        };
      },
      shouldStop: (result) => result.cancel === true,
      terminalLabel: "cancel=true",
    });
  }

  async runMessageSent(
    event: GeneralAgentMessageSentEvent,
    ctx: GeneralAgentMessageHookContext,
  ): Promise<void> {
    await this.runVoidHook("message_sent", event, ctx);
  }

  async runBeforeToolCall(
    event: GeneralAgentBeforeToolCallEvent,
    ctx: GeneralAgentToolHookContext,
  ): Promise<GeneralAgentBeforeToolCallResult | undefined> {
    return this.runModifyingHook("before_tool_call", event, ctx, {
      mergeResults: (acc, next) => {
        if (acc?.block === true) {
          return acc;
        }
        return {
          params: next.params ?? acc?.params,
          block: acc?.block || next.block ? true : undefined,
          blockReason: next.blockReason ?? acc?.blockReason,
        };
      },
      shouldStop: (result) => result.block === true,
      terminalLabel: "block=true",
    });
  }

  async runAfterToolCall(
    event: GeneralAgentAfterToolCallEvent,
    ctx: GeneralAgentToolHookContext,
  ): Promise<void> {
    await this.runVoidHook("after_tool_call", event, ctx);
  }

  runToolResultPersist(
    event: GeneralAgentToolResultPersistEvent,
    ctx: GeneralAgentToolResultPersistContext,
  ): GeneralAgentToolResultPersistResult | undefined {
    const hooks = this.getHooks("tool_result_persist");
    if (hooks.length === 0) {
      return undefined;
    }

    let current = event.message;
    for (const hook of hooks) {
      try {
        const out = hook.handler({ ...event, message: current }, ctx);
        if (isPromiseLike(out)) {
          this.logger.onWarn({
            category: "system",
            message:
              `[hooks] tool_result_persist handler from ${hook.pluginId} returned a Promise; ` +
              "this hook is synchronous and the result was ignored.",
          });
          continue;
        }
        const next = out?.message;
        if (next) {
          current = next;
        }
      } catch (error) {
        this.logHookFailure("tool_result_persist", hook.pluginId, error);
      }
    }

    return { message: current };
  }

  runBeforeMessageWrite(
    event: GeneralAgentBeforeMessageWriteEvent,
    ctx: { agentId?: string; sessionKey?: string },
  ): GeneralAgentBeforeMessageWriteResult | undefined {
    const hooks = this.getHooks("before_message_write");
    if (hooks.length === 0) {
      return undefined;
    }

    let current = event.message;
    for (const hook of hooks) {
      try {
        const out = hook.handler({ ...event, message: current }, ctx);
        if (isPromiseLike(out)) {
          this.logger.onWarn({
            category: "system",
            message:
              `[hooks] before_message_write handler from ${hook.pluginId} returned a Promise; ` +
              "this hook is synchronous and the result was ignored.",
          });
          continue;
        }
        if (out?.block) {
          return { block: true };
        }
        if (out?.message) {
          current = out.message;
        }
      } catch (error) {
        this.logHookFailure("before_message_write", hook.pluginId, error);
      }
    }

    return current === event.message ? undefined : { message: current };
  }

  async runSessionStart(
    event: GeneralAgentSessionStartEvent,
    ctx: GeneralAgentSessionHookContext,
  ): Promise<void> {
    await this.runVoidHook("session_start", event, ctx);
  }

  async runSessionEnd(
    event: GeneralAgentSessionEndEvent,
    ctx: GeneralAgentSessionHookContext,
  ): Promise<void> {
    await this.runVoidHook("session_end", event, ctx);
  }

  async runSubagentSpawning(
    event: GeneralAgentSubagentSpawningEvent,
    ctx: GeneralAgentSubagentHookContext,
  ): Promise<GeneralAgentSubagentSpawningResult | undefined> {
    return this.runModifyingHook("subagent_spawning", event, ctx, {
      mergeResults: (acc, next) => {
        if (acc?.status === "error") {
          return acc;
        }
        if (next.status === "error") {
          return next;
        }
        return {
          status: "ok",
          threadBindingReady: Boolean(acc?.threadBindingReady || next.threadBindingReady),
        };
      },
    });
  }

  async runSubagentDeliveryTarget(
    event: GeneralAgentSubagentDeliveryTargetEvent,
    ctx: GeneralAgentSubagentHookContext,
  ): Promise<GeneralAgentSubagentDeliveryTargetResult | undefined> {
    return this.runModifyingHook("subagent_delivery_target", event, ctx, {
      mergeResults: (acc, next) => {
        if (acc?.origin) {
          return acc;
        }
        return next;
      },
    });
  }

  async runSubagentSpawned(
    event: GeneralAgentSubagentSpawnedEvent,
    ctx: GeneralAgentSubagentHookContext,
  ): Promise<void> {
    await this.runVoidHook("subagent_spawned", event, ctx);
  }

  async runSubagentEnded(
    event: GeneralAgentSubagentEndedEvent,
    ctx: GeneralAgentSubagentHookContext,
  ): Promise<void> {
    await this.runVoidHook("subagent_ended", event, ctx);
  }

  async runGatewayStart(
    event: GeneralAgentGatewayStartEvent,
    ctx: GeneralAgentGatewayHookContext,
  ): Promise<void> {
    await this.runVoidHook("gateway_start", event, ctx);
  }

  async runGatewayStop(
    event: GeneralAgentGatewayStopEvent,
    ctx: GeneralAgentGatewayHookContext,
  ): Promise<void> {
    await this.runVoidHook("gateway_stop", event, ctx);
  }

  async emitHook<TName extends GeneralAgentHookName>(
    request: GeneralAgentHookDispatchRequest<TName>,
  ): Promise<GeneralAgentHookDispatchResult<TName> | undefined> {
    switch (request.hookName) {
      case "before_model_resolve": {
        const typed = request as GeneralAgentHookDispatchRequest<"before_model_resolve">;
        return (await this.runBeforeModelResolve(
          typed.event,
          typed.context,
        )) as GeneralAgentHookDispatchResult<TName> | undefined;
      }
      case "before_prompt_build": {
        const typed = request as GeneralAgentHookDispatchRequest<"before_prompt_build">;
        return (await this.runBeforePromptBuild(
          typed.event,
          typed.context,
        )) as GeneralAgentHookDispatchResult<TName> | undefined;
      }
      case "before_agent_start": {
        const typed = request as GeneralAgentHookDispatchRequest<"before_agent_start">;
        return (await this.runBeforeAgentStart(
          typed.event,
          typed.context,
        )) as GeneralAgentHookDispatchResult<TName> | undefined;
      }
      case "llm_input": {
        const typed = request as GeneralAgentHookDispatchRequest<"llm_input">;
        await this.runLlmInput(typed.event, typed.context);
        return undefined;
      }
      case "llm_output": {
        const typed = request as GeneralAgentHookDispatchRequest<"llm_output">;
        await this.runLlmOutput(typed.event, typed.context);
        return undefined;
      }
      case "agent_end": {
        const typed = request as GeneralAgentHookDispatchRequest<"agent_end">;
        await this.runAgentEnd(typed.event, typed.context);
        return undefined;
      }
      case "before_compaction": {
        const typed = request as GeneralAgentHookDispatchRequest<"before_compaction">;
        await this.runBeforeCompaction(typed.event, typed.context);
        return undefined;
      }
      case "after_compaction": {
        const typed = request as GeneralAgentHookDispatchRequest<"after_compaction">;
        await this.runAfterCompaction(typed.event, typed.context);
        return undefined;
      }
      case "before_reset": {
        const typed = request as GeneralAgentHookDispatchRequest<"before_reset">;
        await this.runBeforeReset(typed.event, typed.context);
        return undefined;
      }
      case "inbound_claim": {
        const typed = request as GeneralAgentHookDispatchRequest<"inbound_claim">;
        return (await this.runInboundClaim(
          typed.event,
          typed.context,
        )) as GeneralAgentHookDispatchResult<TName> | undefined;
      }
      case "message_received": {
        const typed = request as GeneralAgentHookDispatchRequest<"message_received">;
        await this.runMessageReceived(typed.event, typed.context);
        return undefined;
      }
      case "before_dispatch": {
        const typed = request as GeneralAgentHookDispatchRequest<"before_dispatch">;
        return (await this.runBeforeDispatch(
          typed.event,
          typed.context,
        )) as GeneralAgentHookDispatchResult<TName> | undefined;
      }
      case "message_sending": {
        const typed = request as GeneralAgentHookDispatchRequest<"message_sending">;
        return (await this.runMessageSending(
          typed.event,
          typed.context,
        )) as GeneralAgentHookDispatchResult<TName> | undefined;
      }
      case "message_sent": {
        const typed = request as GeneralAgentHookDispatchRequest<"message_sent">;
        await this.runMessageSent(typed.event, typed.context);
        return undefined;
      }
      case "before_tool_call": {
        const typed = request as GeneralAgentHookDispatchRequest<"before_tool_call">;
        return (await this.runBeforeToolCall(
          typed.event,
          typed.context,
        )) as GeneralAgentHookDispatchResult<TName> | undefined;
      }
      case "after_tool_call": {
        const typed = request as GeneralAgentHookDispatchRequest<"after_tool_call">;
        await this.runAfterToolCall(typed.event, typed.context);
        return undefined;
      }
      case "tool_result_persist": {
        const typed = request as GeneralAgentHookDispatchRequest<"tool_result_persist">;
        return this.runToolResultPersist(
          typed.event,
          typed.context,
        ) as GeneralAgentHookDispatchResult<TName> | undefined;
      }
      case "before_message_write": {
        const typed = request as GeneralAgentHookDispatchRequest<"before_message_write">;
        return this.runBeforeMessageWrite(
          typed.event,
          typed.context,
        ) as GeneralAgentHookDispatchResult<TName> | undefined;
      }
      case "session_start": {
        const typed = request as GeneralAgentHookDispatchRequest<"session_start">;
        await this.runSessionStart(typed.event, typed.context);
        return undefined;
      }
      case "session_end": {
        const typed = request as GeneralAgentHookDispatchRequest<"session_end">;
        await this.runSessionEnd(typed.event, typed.context);
        return undefined;
      }
      case "subagent_spawning": {
        const typed = request as GeneralAgentHookDispatchRequest<"subagent_spawning">;
        return (await this.runSubagentSpawning(
          typed.event,
          typed.context,
        )) as GeneralAgentHookDispatchResult<TName> | undefined;
      }
      case "subagent_delivery_target": {
        const typed = request as GeneralAgentHookDispatchRequest<"subagent_delivery_target">;
        return (await this.runSubagentDeliveryTarget(
          typed.event,
          typed.context,
        )) as GeneralAgentHookDispatchResult<TName> | undefined;
      }
      case "subagent_spawned": {
        const typed = request as GeneralAgentHookDispatchRequest<"subagent_spawned">;
        await this.runSubagentSpawned(typed.event, typed.context);
        return undefined;
      }
      case "subagent_ended": {
        const typed = request as GeneralAgentHookDispatchRequest<"subagent_ended">;
        await this.runSubagentEnded(typed.event, typed.context);
        return undefined;
      }
      case "gateway_start": {
        const typed = request as GeneralAgentHookDispatchRequest<"gateway_start">;
        await this.runGatewayStart(typed.event, typed.context);
        return undefined;
      }
      case "gateway_stop": {
        const typed = request as GeneralAgentHookDispatchRequest<"gateway_stop">;
        await this.runGatewayStop(typed.event, typed.context);
        return undefined;
      }
      default: {
        const _exhaustive: never = request.hookName;
        return _exhaustive;
      }
    }
  }

  private async runVoidHook<TName extends GeneralAgentHookName>(
    hookName: TName,
    event: Parameters<HookHandler<TName>>[0],
    ctx: Parameters<HookHandler<TName>>[1],
  ): Promise<void> {
    const hooks = this.getHooks(hookName);
    if (hooks.length === 0) {
      return;
    }

    await Promise.all(
      hooks.map(async (hook) => {
        try {
          await (hook.handler as (event: unknown, ctx: unknown) => Promise<void> | void)(event, ctx);
        } catch (error) {
          this.logHookFailure(hookName, hook.pluginId, error);
        }
      }),
    );
  }

  private async runModifyingHook<TName extends GeneralAgentHookName, TResult>(
    hookName: TName,
    event: Parameters<HookHandler<TName>>[0],
    ctx: Parameters<HookHandler<TName>>[1],
    policy: ModifyingHookPolicy<TName, TResult> = {},
  ): Promise<TResult | undefined> {
    const hooks = this.getHooks(hookName);
    if (hooks.length === 0) {
      return undefined;
    }

    let result: TResult | undefined;
    for (const hook of hooks) {
      try {
        const next = (await (hook.handler as (event: unknown, ctx: unknown) => Promise<TResult | void> | TResult | void)(
          event,
          ctx,
        )) as TResult | void;
        if (next === undefined || next === null) {
          continue;
        }
        result = policy.mergeResults ? policy.mergeResults(result, next) : next;
        if (result && policy.shouldStop?.(result)) {
          policy.onTerminal?.({
            hookName,
            pluginId: hook.pluginId,
            result,
          });
          break;
        }
      } catch (error) {
        this.logHookFailure(hookName, hook.pluginId, error);
      }
    }

    return result;
  }

  private async runClaimingHook<TName extends GeneralAgentHookName, TResult extends { handled: boolean }>(
    hookName: TName,
    event: Parameters<HookHandler<TName>>[0],
    ctx: Parameters<HookHandler<TName>>[1],
  ): Promise<TResult | undefined> {
    const hooks = this.getHooks(hookName);
    if (hooks.length === 0) {
      return undefined;
    }

    for (const hook of hooks) {
      try {
        const result = (await (hook.handler as (event: unknown, ctx: unknown) => Promise<TResult | void> | TResult | void)(
          event,
          ctx,
        )) as TResult | void;
        if (result?.handled) {
          return result;
        }
      } catch (error) {
        this.logHookFailure(hookName, hook.pluginId, error);
      }
    }

    return undefined;
  }

  private getHooks<TName extends GeneralAgentHookName>(
    hookName: TName,
  ): Array<Extract<GeneralAgentHookRegistration, { hookName: TName }>> {
    return this.hooks.filter(
      (hook): hook is Extract<GeneralAgentHookRegistration, { hookName: TName }> =>
        hook.hookName === hookName,
    );
  }

  private logHookFailure(
    hookName: GeneralAgentHookName,
    pluginId: string,
    error: unknown,
  ): void {
    const message = `[hooks] ${hookName} handler from ${pluginId} failed: ${String(error)}`;
    this.logger.onError({
      category: "system",
      message,
      data: {
        hookName,
        pluginId,
      },
    });
  }
}
