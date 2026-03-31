import { describe, expect, it } from "vitest";
import {
  createGeneralAgentSdk,
  type GeneralAgentHookDispatchRequest,
  type GeneralAgentHookDispatchResult,
  type GeneralAgentFileCheckpoint,
  type GeneralAgentForkSessionParams,
  type GeneralAgentHookRegistration,
  type GeneralAgentSdk,
  type GeneralAgentSdkOptions,
  type GeneralAgentSession,
  type GeneralAgentSessionParams,
  type GeneralAgentStoredSessionSummary,
  type GeneralAgentStreamEvent,
} from "../../src/index.js";

describe("public API", () => {
  it("exports the session-first SDK surface", () => {
    expect(typeof createGeneralAgentSdk).toBe("function");

    type _Sdk = GeneralAgentSdk;
    type _HookRegistration = GeneralAgentHookRegistration;
    type _Checkpoint = GeneralAgentFileCheckpoint;
    type _Fork = GeneralAgentForkSessionParams;
    type _Options = GeneralAgentSdkOptions;
    type _Session = GeneralAgentSession;
    type _SessionParams = GeneralAgentSessionParams;
    type _Summary = GeneralAgentStoredSessionSummary;
    type _StreamEvent = GeneralAgentStreamEvent;

    void (0 as unknown as _HookRegistration);
    void (0 as unknown as _Checkpoint);
    void (0 as unknown as _Fork);
    void (0 as unknown as _Summary);
    expect(true).toBe(true);
  });

  it("exposes sdk tool configuration on public options", () => {
    const options: GeneralAgentSdkOptions = {
      workspaceDir: "/tmp/workspace",
      stateDir: "/tmp/state",
      agentDir: "/tmp/agent",
      profileId: "default",
      pluginMode: "disabled",
      logger: {
        onDebug() {},
        onInfo() {},
        onWarn() {},
        onError() {},
      },
      sessionStore: {
        async load() {
          return null;
        },
        async save() {},
        async resolveSessionFile() {
          return "/tmp/state/session.jsonl";
        },
      },
      tools: {
        web: {
          fetch: {
            firecrawl: {
              apiKey: "firecrawl-test",
              baseUrl: "https://firecrawl.example",
            },
          },
          search: {
            apiKey: "brave-test",
          },
        },
      },
    };

    expect(options.tools?.web?.fetch?.firecrawl?.apiKey).toBe("firecrawl-test");
    expect(options.tools?.web?.search?.apiKey).toBe("brave-test");
  });

  it("exposes tool-result hook messages with toolResult shape", () => {
    type ToolResultPersistHook = Extract<
      GeneralAgentHookRegistration,
      { hookName: "tool_result_persist" }
    >;
    type BeforeMessageWriteHook = Extract<
      GeneralAgentHookRegistration,
      { hookName: "before_message_write" }
    >;

    type ToolResultPersistMessage = Parameters<ToolResultPersistHook["handler"]>[0]["message"];
    type BeforeMessageWriteMessage = Parameters<BeforeMessageWriteHook["handler"]>[0]["message"];

    const toolResultMessage: ToolResultPersistMessage = {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "finish",
      content: [{ type: "text", text: "ok" }],
      details: { source: "host" },
      isError: false,
      timestamp: Date.now(),
    };

    const beforeWriteMessage: BeforeMessageWriteMessage = toolResultMessage;

    expect(toolResultMessage.role).toBe("toolResult");
    expect(beforeWriteMessage.role).toBe("toolResult");
  });

  it("exposes checkpoint session methods and checkpoint metadata shape", () => {
    type Checkpoint = GeneralAgentFileCheckpoint;

    const checkpoint: Checkpoint = {
      id: "cp_123",
      toolName: "write",
      callId: "call_123",
      createdAtMs: Date.now(),
      files: [
        {
          path: "notes.txt",
          existedBefore: false,
        },
      ],
    };

    type SessionCheckpointMethods = Pick<
      GeneralAgentSession,
      "listCheckpoints" | "restoreCheckpoint" | "reset"
    >;

    void (0 as unknown as SessionCheckpointMethods);
    expect(checkpoint.files[0]?.path).toBe("notes.txt");
  });

  it("exposes session lifecycle SDK methods and session summary shape", () => {
    const summary: GeneralAgentStoredSessionSummary = {
      sessionId: "sess_123",
      sessionKey: "host:default:sess_123",
      mode: "general",
      modelRef: "openai/gpt-5.4",
      systemPrompt: "Stay focused.",
      transcriptPath: "/tmp/session.jsonl",
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    };

    const forkParams: GeneralAgentForkSessionParams = {
      identity: {
        mode: "general",
        sessionId: "sess_fork",
        sessionKey: "host:default:sess_fork",
      },
      sessionFile: "/tmp/fork.jsonl",
    };

    type SessionLifecycleMethods = Pick<
      GeneralAgentSdk,
      | "continueSession"
      | "resumeSession"
      | "forkSession"
      | "listSessions"
      | "readSessionHistory"
    >;

    void (0 as unknown as SessionLifecycleMethods);
    expect(summary.sessionId).toBe("sess_123");
    expect(forkParams.identity.sessionId).toBe("sess_fork");
  });

  it("exposes OpenClaw-aligned hook families and typed hook dispatch APIs", () => {
    type BeforeModelResolveHook = Extract<
      GeneralAgentHookRegistration,
      { hookName: "before_model_resolve" }
    >;
    type BeforePromptBuildHook = Extract<
      GeneralAgentHookRegistration,
      { hookName: "before_prompt_build" }
    >;
    type MessageSendingHook = Extract<
      GeneralAgentHookRegistration,
      { hookName: "message_sending" }
    >;
    type SessionStartHook = Extract<
      GeneralAgentHookRegistration,
      { hookName: "session_start" }
    >;
    type SubagentDeliveryTargetHook = Extract<
      GeneralAgentHookRegistration,
      { hookName: "subagent_delivery_target" }
    >;

    type BeforeModelResolveResult = Awaited<
      ReturnType<BeforeModelResolveHook["handler"]>
    >;
    type BeforePromptBuildResult = Awaited<
      ReturnType<BeforePromptBuildHook["handler"]>
    >;
    type MessageSendingResult = Awaited<
      ReturnType<MessageSendingHook["handler"]>
    >;
    type SessionStartEvent = Parameters<SessionStartHook["handler"]>[0];
    type SubagentDeliveryTargetResult = Awaited<
      ReturnType<SubagentDeliveryTargetHook["handler"]>
    >;

    const modelResolve: BeforeModelResolveResult = {
      providerOverride: "openai",
      modelOverride: "gpt-5.4",
    };
    const promptBuild: BeforePromptBuildResult = {
      prependSystemContext: "System guidance",
      prependContext: "User guidance",
    };
    const messageSending: MessageSendingResult = {
      content: "rewritten",
      cancel: false,
    };
    const sessionStart: SessionStartEvent = {
      sessionId: "sess_123",
      sessionKey: "host:default:sess_123",
      resumedFrom: "sess_old",
    };
    const deliveryTarget: SubagentDeliveryTargetResult = {
      origin: {
        channel: "discord",
        to: "channel:123",
      },
    };

    const dispatchRequest: GeneralAgentHookDispatchRequest<"message_sending"> = {
      hookName: "message_sending",
      event: {
        to: "channel:123",
        content: "hello",
      },
      context: {
        channelId: "discord",
      },
    };

    type DispatchMethod = GeneralAgentSdk["emitHook"];
    type MessageSendingDispatchResult = GeneralAgentHookDispatchResult<"message_sending">;

    void (0 as unknown as DispatchMethod);
    void (0 as unknown as MessageSendingDispatchResult);
    expect(modelResolve?.providerOverride).toBe("openai");
    expect(promptBuild?.prependSystemContext).toBe("System guidance");
    expect(messageSending?.content).toBe("rewritten");
    expect(sessionStart.resumedFrom).toBe("sess_old");
    expect(deliveryTarget?.origin?.channel).toBe("discord");
    expect(dispatchRequest.hookName).toBe("message_sending");
  });
});
