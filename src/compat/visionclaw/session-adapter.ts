import type { GeneralAgentStreamEvent } from "../../public/events.js";
import type { GeneralAgentAgentSession } from "../../public/session.js";
import type { GeneralAgentTurnInput, GeneralAgentUsageSnapshot } from "../../public/types.js";
import { normalizeGeneralAgentEventForVisionClaw } from "./events.js";
import type {
  VisionClawCompatSessionLike,
  VisionClawCompatStreamMessage,
  VisionClawCompatUserContent,
  VisionClawSessionAdapterArgs,
} from "./types.js";

export function createVisionClawSessionAdapter(
  args: VisionClawSessionAdapterArgs,
): VisionClawCompatSessionLike {
  const sdkSession = args.sdk.createSession(args.sessionParams);
  let inputClosed = true;
  let lastSessionId: string | null = args.sessionParams.identity.sessionId;
  let lastUsageSnapshot = sdkSession.getUsageSnapshot();

  if (args.initialDynamicMcpServers) {
    sdkSession.setDynamicMcpServers(args.initialDynamicMcpServers);
  }

  return {
    async *sendAndStream(content) {
      inputClosed = false;
      try {
        yield* consumeSdkEvents(
          sdkSession,
          sdkSession.streamTurn(toGeneralAgentTurnInput(content)),
          args,
          (sessionId) => {
            lastSessionId = sessionId;
          },
          (snapshot) => {
            lastUsageSnapshot = snapshot;
          },
        );
      } finally {
        inputClosed = true;
      }
    },
    injectMessage(content) {
      return sdkSession.injectMessage(toGeneralAgentTurnInput(content));
    },
    closeInput() {
      inputClosed = true;
      sdkSession.closeInput();
    },
    requestStop() {
      sdkSession.requestStop();
    },
    clearStop() {
      sdkSession.clearStop();
    },
    isStopRequested() {
      return sdkSession.isStopRequested();
    },
    requestCompaction() {
      return sdkSession.requestCompaction();
    },
    maybeCompactByTokens(options) {
      return sdkSession.maybeCompactByTokens(options);
    },
    captureSessionId(id) {
      if (id) {
        lastSessionId = id;
      }
    },
    captureUsageSnapshot(snapshot) {
      lastUsageSnapshot = {
        usedInputTokens: snapshot.usedInputTokens,
        contextWindow: snapshot.contextWindow,
        usedPct: snapshot.usedPct,
        capturedAtMs: snapshot.capturedAtMs ?? Date.now(),
      };
    },
    capturePostCompactionSnapshot(postCompactionTokens) {
      const contextWindow = lastUsageSnapshot?.contextWindow ?? 0;
      if (contextWindow > 0) {
        lastUsageSnapshot = {
          usedInputTokens: postCompactionTokens,
          contextWindow,
          usedPct: Number(((postCompactionTokens / contextWindow) * 100).toFixed(4)),
          capturedAtMs: Date.now(),
        };
      }
    },
    getSessionId() {
      return lastSessionId;
    },
    getTranscriptPath() {
      return sdkSession.getTranscriptPath();
    },
    getUsageSnapshot() {
      return lastUsageSnapshot;
    },
    getCurrentQuery() {
      return sdkSession.getCurrentQuery();
    },
    setDynamicMcpServers(servers) {
      sdkSession.setDynamicMcpServers(servers);
    },
    getDynamicMcpServers() {
      return sdkSession.getDynamicMcpServers();
    },
    hasOrphanedInjections: false,
    get isInputClosed() {
      return inputClosed;
    },
  };
}

async function* consumeSdkEvents(
  sdkSession: GeneralAgentAgentSession,
  events: AsyncIterable<GeneralAgentStreamEvent>,
  args: VisionClawSessionAdapterArgs,
  onSessionId: (sessionId: string) => void,
  onUsageSnapshot: (snapshot: GeneralAgentUsageSnapshot | null) => void,
): AsyncIterable<VisionClawCompatStreamMessage> {
  let pendingToolCall: Extract<GeneralAgentStreamEvent, { kind: "tool_call" }> | null = null;

  for await (const event of events) {
    if (event.kind === "usage_snapshot") {
      onUsageSnapshot(event.snapshot);
      yield normalizeGeneralAgentEventForVisionClaw(event);
      continue;
    }

    if (
      pendingToolCall
      && event.kind === "hosted_tool_call"
      && event.callId === pendingToolCall.callId
    ) {
      pendingToolCall = null;
      yield attachSessionId(
        args.sessionParams.identity.sessionId,
        normalizeGeneralAgentEventForVisionClaw(event),
      );
      const execution = await args.hostedToolExecutor.execute(
        event.toolName,
        event.input,
      );
      const resumedEvents = execution.ok
        ? sdkSession.submitHostedToolResult({
            callId: event.callId,
            output: execution.output,
          })
        : sdkSession.submitHostedToolError({
            callId: event.callId,
            error: execution.error,
          });
      yield* consumeSdkEvents(
        sdkSession,
        resumedEvents,
        args,
        onSessionId,
        onUsageSnapshot,
      );
      continue;
    }

    if (pendingToolCall) {
      yield attachSessionId(
        args.sessionParams.identity.sessionId,
        normalizeGeneralAgentEventForVisionClaw(pendingToolCall),
      );
      pendingToolCall = null;
    }

    if (event.kind === "tool_call") {
      pendingToolCall = event;
      continue;
    }

    yield attachSessionId(
      args.sessionParams.identity.sessionId,
      normalizeGeneralAgentEventForVisionClaw(event),
    );
    onSessionId(sdkSession.getSessionId());
  }

  if (pendingToolCall) {
    yield attachSessionId(
      args.sessionParams.identity.sessionId,
      normalizeGeneralAgentEventForVisionClaw(pendingToolCall),
    );
  }
}

function attachSessionId(
  sessionId: string,
  message: VisionClawCompatStreamMessage,
): VisionClawCompatStreamMessage {
  if (message.type === "result") {
    return message;
  }

  return { ...message, session_id: sessionId };
}

function toGeneralAgentTurnInput(content: VisionClawCompatUserContent): GeneralAgentTurnInput {
  const normalized = typeof content === "string"
    ? [{ type: "text", text: content } as const]
    : content;

  return {
    role: "user",
    content: normalized.map((entry) => {
      if (entry.type === "text") {
        return { type: "text" as const, text: entry.text };
      }

      if (entry.type === "tool_result") {
        return {
          type: "tool_result" as const,
          callId: entry.tool_use_id,
          output: entry.content,
          isError: entry.is_error,
        };
      }

      return {
        type: "image" as const,
        mimeType: entry.source.media_type,
        data: entry.source.data,
      };
    }),
  };
}
