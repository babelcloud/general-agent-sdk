# OpenClaw Agent SDK Thin-Host Realignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the OpenClaw-specific VisionClaw bridge into `openclaw-agent-sdk/compat/visionclaw` so VisionClaw keeps only host-owned state, lazy loading, host tool execution, and thin orchestration glue.

**Architecture:** The current integration already works, but too much OpenClaw protocol logic still lives in VisionClaw. First add a typed `compat/visionclaw` surface to the SDK with contract and integration tests. Then make the VisionClaw feature worktree consume that surface through a lazy loader and thin session wrapper, while keeping `conversation-journal.ts`, continuation cursors, system-prompt construction, and actual host tool execution in VisionClaw. Finish by verifying packaging, regression safety, and two-repo SHA traceability.

**Tech Stack:** TypeScript, Node.js `>=22.14.0` in the SDK and `24.12.0` in VisionClaw, pnpm, vitest, dynamic ESM imports, git submodules, structural typing.

**Scope note:** This plan supersedes the host-heavy portions of `/Users/apple/programme/funny_projects/openclaw_agent_sdk/docs/superpowers/plans/2026-03-27-openclaw-agent-sdk.md` starting at the original VisionClaw provider tasks.

---

## File Map

### SDK repository: `/Users/apple/programme/funny_projects/openclaw_agent_sdk`

- `/Users/apple/programme/funny_projects/openclaw_agent_sdk/package.json`: export `./compat/visionclaw` in addition to the root package and `./plugin-sdk`.
- `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/compat/visionclaw/types.ts`: structural VisionClaw-like stream message, content-block, and session-adapter types that do not import VisionClaw source.
- `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/compat/visionclaw/events.ts`: `OpenClawStreamEvent` -> VisionClaw-like message normalization with exact tool names and stable `callId` mapping.
- `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/compat/visionclaw/session-adapter.ts`: wraps `OpenClawAgentSession`, owns pending-tool-call suppression, hosted-tool suspend/resume, and content translation.
- `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/compat/visionclaw/index.ts`: compat barrel export.
- `/Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/contract/visionclaw-compat.test.ts`: compat export shape and normalizer contract.
- `/Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/integration/visionclaw-compat-session.test.ts`: hosted-tool round-trip through the compat adapter.
- `/Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/integration/distribution-and-ci.test.ts`: packaged SDK still contains the compat entrypoint.

### VisionClaw feature worktree: `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk`

- `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/src/agent/providers/openclaw/sdk-loader.ts`: stays host-owned and lazy-loads both the root SDK and `compat/visionclaw` from staged or submodule builds.
- `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/src/agent/providers/openclaw/sdk-factory.ts`: caches the root SDK instance plus the compat module under one engine-gated signature.
- `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/src/agent/providers/openclaw/session.ts`: becomes a thin `AgentSessionLike` wrapper that builds host-owned adapter args and delegates execution semantics to the SDK compat layer.
- `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/src/agent/providers/openclaw/host-tools.ts`: remains host-owned for actual tool execution and permission checks only.
- `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/src/agent/providers/openclaw/persistence.ts`: remains host-owned for `session.json`, continuation cursor, and profile-rooted artifact paths.
- `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/src/agent/conversation-journal.ts`: remains the canonical cross-engine continuity store.
- `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/src/config/index.ts`: remains the owner of engine-scoped session ids and continuation cursors.
- `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/src/agent/providers/openclaw/event-normalizer.ts`: delete in the same task that switches `session.ts` to the SDK compat adapter; do not leave real logic here.
- `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/src/agent/providers/openclaw/sdk-types.ts`: delete in the same task that switches the host to SDK-exported structural types.
- `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/tests/unit/agent/openclaw-sdk-loader.test.ts`: compat-path candidate resolution and lazy loader behavior.
- `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/tests/unit/agent/openclaw-session-adapter.test.ts`: thin host wrapper builds correct adapter args and does not duplicate event semantics.
- `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/tests/unit/agent/conversation-journal.test.ts`: exact tool-name continuity and cursor ownership.
- `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/tests/integration/openclaw-thin-host.test.ts`: selected-engine path works through the compat adapter and non-selected engines remain unaffected.
- `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/tests/integration/session-manager.test.ts`: engine dispatch still works.
- `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/tests/integration/stream-handler.test.ts`: existing `tool_use` / `tool_result` behavior remains intact.
- `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/tests/integration/claude-sdk.test.ts`: non-OpenClaw regression guard.

### Cross-repo sequencing rule

- Tasks 1 and 2 happen only in `/Users/apple/programme/funny_projects/openclaw_agent_sdk`.
- Task 3 pushes the SDK SHA and updates the VisionClaw submodule pointer before VisionClaw consumes the new compat surface.
- Tasks 4 and 5 happen only in `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk`.

### Task 1: Add The SDK-Owned `compat/visionclaw` Contract Surface

**Files:**
- Modify: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/package.json`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/compat/visionclaw/types.ts`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/compat/visionclaw/events.ts`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/compat/visionclaw/session-adapter.ts`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/compat/visionclaw/index.ts`
- Test: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/contract/visionclaw-compat.test.ts`

- [ ] **Step 1: Write the failing compat contract test**

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/contract/visionclaw-compat.test.ts
import { describe, expect, it } from "vitest";
import {
  createVisionClawSessionAdapter,
  normalizeOpenClawEventForVisionClaw,
  type VisionClawCompatSessionLike,
  type VisionClawCompatStreamMessage,
} from "../../src/compat/visionclaw/index.js";

describe("compat/visionclaw contract", () => {
  it("exports a VisionClaw-compatible normalizer without renaming tools", () => {
    const normalized = normalizeOpenClawEventForVisionClaw({
      kind: "tool_call",
      callId: "call-1",
      toolName: "exec",
      input: { command: "pwd" },
    });

    expect(normalized).toEqual({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            name: "exec",
            input: { command: "pwd" },
            id: "call-1",
          },
        ],
      },
    });

    expect(typeof createVisionClawSessionAdapter).toBe("function");

    type _Session = VisionClawCompatSessionLike;
    type _Message = VisionClawCompatStreamMessage;
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run:

```bash
cd /Users/apple/programme/funny_projects/openclaw_agent_sdk
pnpm exec vitest run tests/contract/visionclaw-compat.test.ts
```

Expected: FAIL because `src/compat/visionclaw/index.js` does not exist yet.

- [ ] **Step 3: Add the compat types, normalizer, barrel, and package export**

```json
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/package.json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./compat/visionclaw": {
      "types": "./dist/compat/visionclaw/index.d.ts",
      "default": "./dist/compat/visionclaw/index.js"
    },
    "./plugin-sdk": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  }
}
```

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/compat/visionclaw/types.ts
import type { OpenClawHostedToolErrorInput, OpenClawHostedToolResultInput } from "../../public/host-tools.js";
import type { OpenClawAgentSdk } from "../../public/sdk.js";
import type {
  OpenClawCompactionOptions,
  OpenClawCurrentQueryLike,
  OpenClawSessionParams,
  OpenClawUsageSnapshot,
} from "../../public/types.js";

export type VisionClawCompatUserContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | {
          type: "tool_result";
          tool_use_id: string;
          content: unknown;
          is_error?: boolean;
        }
      | {
          type: "image";
          source: { type: "base64"; media_type: string; data: string };
        }
    >;

export type VisionClawCompatStreamMessage =
  | {
      type: "assistant";
      session_id?: string;
      message: {
        role: "assistant";
        content: Array<
          | { type: "text"; text: string }
          | { type: "thinking"; thinking: string }
          | { type: "tool_use"; name: string; input: unknown; id?: string }
        >;
      };
      parent_tool_use_id?: string | null;
    }
  | {
      type: "user";
      session_id?: string;
      message: {
        role: "user";
        content: Array<{
          type: "tool_result";
          tool_use_id: string;
          content: unknown;
          is_error?: boolean;
        }>;
      };
      parent_tool_use_id?: string | null;
    }
  | {
      type: "result";
      subtype: string;
      num_turns: number;
      usage: {
        input_tokens: number;
        output_tokens: number;
      };
      total_cost_usd: number;
      is_error: boolean;
    }
  | {
      type: "system";
      subtype: string;
      session_id?: string;
      [key: string]: unknown;
    };

export type VisionClawHostedToolExecution =
  | { ok: true; output: unknown }
  | { ok: false; error: string };

export interface VisionClawHostedToolExecutor {
  execute(toolName: string, input: Record<string, unknown>): Promise<VisionClawHostedToolExecution>;
}

export interface VisionClawCompatSessionLike {
  sendAndStream(content: VisionClawCompatUserContent): AsyncIterable<VisionClawCompatStreamMessage>;
  injectMessage(content: VisionClawCompatUserContent): boolean;
  closeInput(): void;
  requestStop(): void;
  clearStop(): void;
  isStopRequested(): boolean;
  requestCompaction(): Promise<void>;
  maybeCompactByTokens(options?: OpenClawCompactionOptions): Promise<void>;
  captureSessionId(id: string | undefined): void;
  captureUsageSnapshot(snapshot: {
    usedInputTokens: number;
    contextWindow: number;
    usedPct: number;
    capturedAtMs?: number;
  }): void;
  capturePostCompactionSnapshot(postCompactionTokens: number): void;
  getSessionId(): string | null;
  getTranscriptPath(): string | null;
  getUsageSnapshot(): OpenClawUsageSnapshot | null;
  getCurrentQuery(): OpenClawCurrentQueryLike | null;
  setDynamicMcpServers(servers: Record<string, Record<string, unknown>>): void;
  getDynamicMcpServers(): Record<string, Record<string, unknown>>;
  readonly hasOrphanedInjections: boolean;
  readonly isInputClosed: boolean;
}

export interface VisionClawSessionAdapterArgs {
  sdk: OpenClawAgentSdk;
  sessionParams: OpenClawSessionParams;
  hostedToolExecutor: VisionClawHostedToolExecutor;
  initialDynamicMcpServers?: Record<string, Record<string, unknown>>;
}

export type HostedToolResumeInput =
  | OpenClawHostedToolResultInput
  | OpenClawHostedToolErrorInput;
```

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/compat/visionclaw/events.ts
import type { OpenClawStreamEvent } from "../../public/events.js";
import type { VisionClawCompatStreamMessage } from "./types.js";

export function normalizeOpenClawEventForVisionClaw(
  event: OpenClawStreamEvent,
): VisionClawCompatStreamMessage {
  switch (event.kind) {
    case "assistant_delta":
      return {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: event.text }],
        },
      };
    case "reasoning_delta":
      return {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: event.text }],
        },
      };
    case "tool_call":
    case "hosted_tool_call":
      return {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: event.toolName,
              input: event.input,
              id: event.callId,
            },
          ],
        },
      };
    case "tool_result":
      return {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: event.callId,
              content: event.output,
              is_error: event.isError,
            },
          ],
        },
      };
    case "tool_error":
      return {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: event.callId,
              content: event.error,
              is_error: true,
            },
          ],
        },
      };
    case "turn_complete":
      return {
        type: "result",
        subtype: event.stopReason,
        num_turns: 1,
        usage: { input_tokens: 0, output_tokens: 0 },
        total_cost_usd: 0,
        is_error: event.stopReason === "tool_error" || event.stopReason.startsWith("error"),
      };
    case "usage_snapshot":
      return { type: "system", subtype: "usage_snapshot", snapshot: event.snapshot };
    case "compaction_started":
      return { type: "system", subtype: "compaction_started", reason: event.reason };
    case "compaction_finished":
      return {
        type: "system",
        subtype: "compaction_finished",
        reason: event.reason,
        tokensAfter: event.tokensAfter,
      };
    case "reasoning_end":
      return { type: "system", subtype: "reasoning_end" };
  }
}
```

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/compat/visionclaw/session-adapter.ts
import type { VisionClawSessionAdapterArgs, VisionClawCompatSessionLike } from "./types.js";

export function createVisionClawSessionAdapter(
  _args: VisionClawSessionAdapterArgs,
): VisionClawCompatSessionLike {
  throw new Error("VisionClaw compat session adapter is not implemented yet");
}
```

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/compat/visionclaw/index.ts
export * from "./types.js";
export * from "./events.js";
export * from "./session-adapter.js";
```

- [ ] **Step 4: Run the contract test and typecheck**

Run:

```bash
cd /Users/apple/programme/funny_projects/openclaw_agent_sdk
pnpm run check
pnpm exec vitest run tests/contract/visionclaw-compat.test.ts
```

Expected: both commands PASS. The session-adapter test coverage still does not exist, so the placeholder `throw new Error(...)` is acceptable at this step.

- [ ] **Step 5: Commit the compat surface shell**

Run:

```bash
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk add package.json src/compat tests/contract
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk commit \
  -m "feat: add visionclaw compat sdk surface" \
  -m "Spec: docs/superpowers/specs/2026-03-27-openclaw-agent-sdk-design.md" \
  -m "Phase: phase-4-sdk-compat-shell" \
  -m "Upstream-OpenClaw-SHA: none"
```

Expected: the SDK now exports a buildable `./compat/visionclaw` surface, even though the session adapter is still unimplemented.

### Task 2: Implement The SDK VisionClaw Session Adapter And Distribution Coverage

**Files:**
- Modify: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/compat/visionclaw/session-adapter.ts`
- Modify: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/compat/visionclaw/types.ts`
- Modify: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/compat/visionclaw/events.ts`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/integration/visionclaw-compat-session.test.ts`
- Modify: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/integration/distribution-and-ci.test.ts`

- [ ] **Step 1: Write the failing integration tests for hosted-tool resume and packaged compat export**

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/integration/visionclaw-compat-session.test.ts
import { describe, expect, it } from "vitest";
import { createOpenClawAgentSdk } from "../../src/index.js";
import { createVisionClawSessionAdapter } from "../../src/compat/visionclaw/index.js";

describe("VisionClaw compat session adapter", () => {
  it("preserves hosted-tool tool_use -> tool_result continuity without renaming exec", async () => {
    const sdk = await createOpenClawAgentSdk({
      workspaceDir: "/tmp/openclaw-sdk-workspace",
      stateDir: "/tmp/openclaw-sdk-state",
      agentDir: "/tmp/openclaw-sdk-agent",
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
          return "/tmp/openclaw-sdk-state/general.jsonl";
        },
      },
      hostedTools: [
        {
          name: "exec",
          description: "Run a host command",
          inputSchema: {},
        },
      ],
    });

    const session = createVisionClawSessionAdapter({
      sdk,
      sessionParams: {
        identity: {
          mode: "general",
          sessionId: "sess-general",
          sessionKey: "visionclaw:default:general",
        },
        systemPrompt: "Use exec when asked.",
        modelRef: "openai/gpt-5.4",
        sessionFile: "/tmp/openclaw-sdk-state/general.jsonl",
      },
      hostedToolExecutor: {
        async execute(toolName, input) {
          return { ok: true, output: { toolName, input } };
        },
      },
    });

    const chunks = [];
    for await (const chunk of session.sendAndStream("please exec")) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toMatchObject({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "exec" }],
      },
    });
    expect(chunks[1]).toMatchObject({
      type: "user",
      message: {
        content: [{ type: "tool_result", content: { toolName: "exec", input: {} } }],
      },
    });

    await sdk.shutdown();
  });
});
```

```ts
// Append to /Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/integration/distribution-and-ci.test.ts
import fs from "node:fs";
import path from "node:path";

it("keeps the compat/visionclaw entrypoint in the built dist tree", () => {
  const compatEntrypoint = path.join(process.cwd(), "dist", "compat", "visionclaw", "index.js");
  expect(fs.existsSync(compatEntrypoint)).toBe(true);
});
```

- [ ] **Step 2: Run the integration tests and verify the shell implementation fails**

Run:

```bash
cd /Users/apple/programme/funny_projects/openclaw_agent_sdk
pnpm exec vitest run \
  tests/integration/visionclaw-compat-session.test.ts \
  tests/integration/distribution-and-ci.test.ts
```

Expected: FAIL because `createVisionClawSessionAdapter()` still throws and the compat dist entrypoint is not yet part of the build output.

- [ ] **Step 3: Implement the adapter, event suppression, content translation, and packaged compat export**

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/compat/visionclaw/session-adapter.ts
import type { OpenClawStreamEvent } from "../../public/events.js";
import type { OpenClawTurnInput } from "../../public/types.js";
import { normalizeOpenClawEventForVisionClaw } from "./events.js";
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
      yield* consumeSdkEvents(
        sdkSession,
        sdkSession.streamTurn(toOpenClawTurnInput(content)),
        args,
        (sessionId) => {
          lastSessionId = sessionId;
        },
        (snapshot) => {
          lastUsageSnapshot = snapshot;
        },
      );
      inputClosed = true;
    },
    injectMessage(content) {
      return sdkSession.injectMessage(toOpenClawTurnInput(content));
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
  sdkSession: ReturnType<VisionClawSessionAdapterArgs["sdk"]["createSession"]>,
  events: AsyncIterable<OpenClawStreamEvent>,
  args: VisionClawSessionAdapterArgs,
  onSessionId: (sessionId: string) => void,
  onUsageSnapshot: (
    snapshot: ReturnType<ReturnType<VisionClawSessionAdapterArgs["sdk"]["createSession"]>["getUsageSnapshot"]>,
  ) => void,
): AsyncIterable<VisionClawCompatStreamMessage> {
  let pendingToolCall: Extract<OpenClawStreamEvent, { kind: "tool_call" }> | null = null;

  for await (const event of events) {
    if (event.kind === "usage_snapshot") {
      onUsageSnapshot(event.snapshot);
      yield normalizeOpenClawEventForVisionClaw(event);
      continue;
    }

    if (pendingToolCall && event.kind === "hosted_tool_call" && event.callId === pendingToolCall.callId) {
      pendingToolCall = null;
      yield attachSessionId(args.sessionParams.identity.sessionId, normalizeOpenClawEventForVisionClaw(event));
      const execution = await args.hostedToolExecutor.execute(event.toolName, event.input);
      const resume = execution.ok
        ? sdkSession.submitHostedToolResult({ callId: event.callId, output: execution.output })
        : sdkSession.submitHostedToolError({ callId: event.callId, error: execution.error });
      yield* consumeSdkEvents(sdkSession, resume, args, onSessionId, onUsageSnapshot);
      continue;
    }

    if (pendingToolCall) {
      yield attachSessionId(
        args.sessionParams.identity.sessionId,
        normalizeOpenClawEventForVisionClaw(pendingToolCall),
      );
      pendingToolCall = null;
    }

    if (event.kind === "tool_call") {
      pendingToolCall = event;
      continue;
    }

    yield attachSessionId(args.sessionParams.identity.sessionId, normalizeOpenClawEventForVisionClaw(event));
    onSessionId(sdkSession.getSessionId());
  }

  if (pendingToolCall) {
    yield attachSessionId(
      args.sessionParams.identity.sessionId,
      normalizeOpenClawEventForVisionClaw(pendingToolCall),
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

function toOpenClawTurnInput(content: VisionClawCompatUserContent): OpenClawTurnInput {
  const normalized = typeof content === "string" ? [{ type: "text", text: content }] : content;

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
```

```ts
// Replace the compat export assertion in /Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/integration/distribution-and-ci.test.ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("distribution and ci coverage", () => {
  it("keeps the compat/visionclaw entrypoint in the built dist tree", () => {
    const compatEntrypoint = path.join(process.cwd(), "dist", "compat", "visionclaw", "index.js");
    expect(fs.existsSync(compatEntrypoint)).toBe(true);
  });
});
```

- [ ] **Step 4: Run the compat integration tests plus the full SDK verification set**

Run:

```bash
cd /Users/apple/programme/funny_projects/openclaw_agent_sdk
pnpm run check
pnpm run test
pnpm run build
pnpm run test:e2e
```

Expected: all SDK checks PASS and `dist/compat/visionclaw/index.js` exists.

- [ ] **Step 5: Commit and push the compat-capable SDK**

Run:

```bash
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk add package.json src tests
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk commit \
  -m "feat: implement visionclaw compat session adapter" \
  -m "Spec: docs/superpowers/specs/2026-03-27-openclaw-agent-sdk-design.md" \
  -m "Phase: phase-4-sdk-compat-runtime" \
  -m "Upstream-OpenClaw-SHA: none"
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk push -u origin HEAD
```

Expected: the BabelCloud remote now contains an SDK SHA that exports and implements `./compat/visionclaw`.

### Task 3: Pin VisionClaw To The Pushed Compat-Capable SDK SHA

**Files:**
- Modify: `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/.gitmodules`
- Modify: `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/packages/openclaw-agent-sdk` (submodule pointer)

- [ ] **Step 1: Verify the SDK SHA is reachable on the BabelCloud remote**

Run:

```bash
SDK_SHA="$(git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk rev-parse HEAD)"
git ls-remote https://github.com/babelcloud/openclaw-agent-sdk.git "$SDK_SHA"
```

Expected: exactly one line prints and includes the same `SDK_SHA`. If this fails, stop here and do not touch VisionClaw.

- [ ] **Step 2: Add or bump the submodule to the pushed SDK SHA**

Run:

```bash
VC_ROOT="/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk"
if [ ! -d "$VC_ROOT/packages/openclaw-agent-sdk/.git" ]; then
  git -C "$VC_ROOT" submodule add https://github.com/babelcloud/openclaw-agent-sdk.git packages/openclaw-agent-sdk
fi
git -C "$VC_ROOT/packages/openclaw-agent-sdk" fetch origin
git -C "$VC_ROOT/packages/openclaw-agent-sdk" checkout "$SDK_SHA"
```

Expected: the submodule is present and checked out exactly at the pushed compat-capable SDK SHA.

- [ ] **Step 3: Commit the submodule pointer update**

Run:

```bash
VC_ROOT="/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk"
git -C "$VC_ROOT" add .gitmodules packages/openclaw-agent-sdk
git -C "$VC_ROOT" commit \
  -m "chore: bump openclaw-agent-sdk compat surface" \
  -m "Spec: docs/superpowers/specs/2026-03-27-openclaw-agent-sdk-design.md" \
  -m "Phase: phase-4-sdk-bump" \
  -m "OpenClaw-Agent-SDK-SHA: $SDK_SHA"
```

Expected: the VisionClaw worktree records a traceable submodule pointer before any host-side compat consumption changes are made.

### Task 4: Replace The Host-Heavy OpenClaw Bridge With A Thin Compat Wrapper

**Files:**
- Modify: `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/src/agent/providers/openclaw/sdk-loader.ts`
- Modify: `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/src/agent/providers/openclaw/sdk-factory.ts`
- Modify: `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/src/agent/providers/openclaw/session.ts`
- Delete: `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/src/agent/providers/openclaw/sdk-types.ts`
- Delete: `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/src/agent/providers/openclaw/event-normalizer.ts`
- Create: `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/tests/unit/agent/openclaw-session-adapter.test.ts`
- Modify: `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/tests/unit/agent/openclaw-sdk-loader.test.ts`
- Create: `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/tests/integration/openclaw-thin-host.test.ts`

- [ ] **Step 1: Write the failing loader and thin-wrapper tests**

```ts
// /Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/tests/unit/agent/openclaw-sdk-loader.test.ts
import { describe, expect, it } from "vitest";
import { getOpenClawCompatCandidateHrefs } from "../../../src/agent/providers/openclaw/sdk-loader.js";

describe("openclaw sdk loader", () => {
  it("knows how to locate the compat/visionclaw entrypoint", () => {
    expect(
      getOpenClawCompatCandidateHrefs().some((href) =>
        href.endsWith("/compat/visionclaw/index.js"),
      ),
    ).toBe(true);
  });
});
```

```ts
// /Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/tests/unit/agent/openclaw-session-adapter.test.ts
import { describe, expect, it } from "vitest";
import { buildOpenClawSessionAdapterArgs } from "../../../src/agent/providers/openclaw/session.js";

describe("OpenClaw thin session wrapper", () => {
  it("builds host-owned adapter args without redefining SDK stream event types", async () => {
    const args = buildOpenClawSessionAdapterArgs({
      mode: "general",
      profileId: "default",
      sessionId: "sess-general",
      systemPrompt: "Use exec when asked.",
      modelRef: "openai/gpt-5.4",
      sessionFile: "/tmp/visionclaw/providers/openclaw/transcripts/general/sess-general.jsonl",
      authProfileId: "enterprise-default",
      rawEventLogPath: "/tmp/visionclaw/providers/openclaw/raw-stream/2026-03-27.jsonl",
      dualSessionEnabled: true,
      executeHostTool: async (toolName) => ({ ok: true, output: { toolName } }),
    });

    expect(args.sessionParams.identity).toEqual({
      mode: "general",
      sessionId: "sess-general",
      sessionKey: "visionclaw:default:general",
    });
    await expect(args.hostedToolExecutor.execute("finish", {})).resolves.toEqual({
      ok: true,
      output: { toolName: "finish" },
    });
  });
});
```

```ts
// /Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/tests/integration/openclaw-thin-host.test.ts
import { describe, expect, it } from "vitest";

describe("OpenClaw thin-host integration", () => {
  it("runs the selected engine through the SDK compat adapter instead of a host-local event normalizer", async () => {
    expect(true).toBe(false);
  });
});
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run:

```bash
cd /Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk
pnpm exec vitest run \
  tests/unit/agent/openclaw-sdk-loader.test.ts \
  tests/unit/agent/openclaw-session-adapter.test.ts \
  tests/integration/openclaw-thin-host.test.ts
```

Expected: FAIL because the loader does not expose compat candidates yet, `buildOpenClawSessionAdapterArgs()` does not exist, and the integration test has no compat path to exercise.

- [ ] **Step 3: Implement compat loading, state caching, and the thin host wrapper**

```ts
// /Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/src/agent/providers/openclaw/sdk-loader.ts
import type { OpenClawAgentSdk, OpenClawAgentSdkOptions } from "openclaw-agent-sdk";

export interface OpenClawSdkModule {
  createOpenClawAgentSdk(options: OpenClawAgentSdkOptions): Promise<OpenClawAgentSdk>;
}

export interface OpenClawVisionClawCompatModule {
  createVisionClawSessionAdapter(args: Record<string, unknown>): Record<string, unknown>;
}

const SDK_ENTRY_CANDIDATE_URLS = [
  new URL("../../../../dist/vendor/openclaw-agent-sdk/dist/index.js", import.meta.url),
  new URL("../../../../packages/openclaw-agent-sdk/dist/index.js", import.meta.url),
  new URL("../../../../packages/openclaw-agent-sdk/src/index.ts", import.meta.url),
] as const;

const COMPAT_ENTRY_CANDIDATE_URLS = [
  new URL("../../../../dist/vendor/openclaw-agent-sdk/dist/compat/visionclaw/index.js", import.meta.url),
  new URL("../../../../packages/openclaw-agent-sdk/dist/compat/visionclaw/index.js", import.meta.url),
  new URL("../../../../packages/openclaw-agent-sdk/src/compat/visionclaw/index.ts", import.meta.url),
] as const;

let sdkModulePromise: Promise<OpenClawSdkModule> | null = null;
let compatModulePromise: Promise<OpenClawVisionClawCompatModule> | null = null;

export function getOpenClawSdkCandidateHrefs(): readonly string[] {
  return SDK_ENTRY_CANDIDATE_URLS.map((candidate) => candidate.href);
}

export function getOpenClawCompatCandidateHrefs(): readonly string[] {
  return COMPAT_ENTRY_CANDIDATE_URLS.map((candidate) => candidate.href);
}

export async function loadOpenClawSdk(): Promise<OpenClawSdkModule> {
  sdkModulePromise ??= importFirstMatch<OpenClawSdkModule>(getOpenClawSdkCandidateHrefs());
  return sdkModulePromise;
}

export async function loadOpenClawVisionClawCompat(): Promise<OpenClawVisionClawCompatModule> {
  compatModulePromise ??= importFirstMatch<OpenClawVisionClawCompatModule>(
    getOpenClawCompatCandidateHrefs(),
  );
  return compatModulePromise;
}

async function importFirstMatch<T>(candidateHrefs: readonly string[]): Promise<T> {
  let lastError: unknown = null;

  for (const candidate of candidateHrefs) {
    try {
      return await import(/* @vite-ignore */ candidate) as T;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Unable to load OpenClaw entrypoint: ${candidateHrefs.join(", ")}`, {
    cause: lastError,
  });
}
```

```ts
// /Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/src/agent/providers/openclaw/sdk-factory.ts
import type {
  OpenClawAgentSdk,
  OpenClawHostLogger,
  OpenClawLogEvent,
} from "openclaw-agent-sdk";
import type { OpenClawVisionClawCompatModule } from "./sdk-loader.js";
import {
  loadOpenClawSdk,
  loadOpenClawVisionClawCompat,
  resetOpenClawSdkLoaderForTests,
} from "./sdk-loader.js";

interface PreparedOpenClawSdkState {
  signature: string;
  sdk: OpenClawAgentSdk;
  compat: OpenClawVisionClawCompatModule;
}

export function getOpenClawVisionClawCompat(): OpenClawVisionClawCompatModule {
  if (!preparedState) {
    throw new Error("OpenClaw VisionClaw compat module has not been prepared");
  }
  return preparedState.compat;
}

async function initializePreparedState(
  config: OpenClawVisionClawConfig,
  options: PrepareOpenClawSdkOptions,
  signature: string,
): Promise<PreparedOpenClawSdkState> {
  const [sdkModule, compat] = await Promise.all([
    loadOpenClawSdk(),
    loadOpenClawVisionClawCompat(),
  ]);
  const sdk = await sdkModule.createOpenClawAgentSdk({
    workspaceDir: process.cwd(),
    stateDir: getConfigDir(),
    agentDir: path.join(getOpenClawProvidersDir(), "embedded"),
    profileId: getProfile(),
    pluginMode: config.openclaw.pluginMode,
    enabledPluginIds: config.openclaw.enabledPluginIds,
    logger: createOpenClawHostLogger(),
    sessionStore: createVisionClawSessionStore(config.engine),
    hostedTools: buildOpenClawHostedTools({
      dualSessionEnabled: options.dualSessionEnabled,
    }),
    env: buildAgentEnv(config),
  });

  return { signature, sdk, compat };
}
```

```ts
// /Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/src/agent/providers/openclaw/session.ts
import { randomUUID } from "node:crypto";
import type { OpenClawVisionClawConfig } from "../../../config/types.js";
import { getProfile, loadSessionId, saveSessionId, saveUsageSnapshot } from "../../../config/index.js";
import { getModelId } from "../client-factory.js";
import type { AgentSessionConstructorArgs, AgentStreamMessage, CurrentQueryLike } from "../session-types.js";
import { getOpenClawSdk, getOpenClawVisionClawCompat } from "./sdk-factory.js";
import { executeOpenClawHostedToolCall } from "./host-tools.js";
import {
  resolveOpenClawRawEventLogPath,
  resolveOpenClawTranscriptPath,
  toHostUsageSnapshot,
} from "./persistence.js";

export function buildOpenClawSessionAdapterArgs(options: {
  mode: "general" | "coding";
  profileId: string;
  sessionId: string;
  systemPrompt: string;
  modelRef: string;
  sessionFile: string;
  authProfileId?: string;
  rawEventLogPath?: string;
  dualSessionEnabled: boolean;
  executeHostTool: (toolName: string, input: Record<string, unknown>) => Promise<{
    ok: true;
    output: unknown;
  } | {
    ok: false;
    error: string;
  }>;
}) {
  return {
    sessionParams: {
      identity: {
        mode: options.mode,
        sessionId: options.sessionId,
        sessionKey: `visionclaw:${options.profileId}:${options.mode}`,
      },
      systemPrompt: options.systemPrompt,
      modelRef: options.modelRef,
      sessionFile: options.sessionFile,
      authProfileId: options.authProfileId,
      rawEventLogPath: options.rawEventLogPath,
    },
    hostedToolExecutor: {
      execute: options.executeHostTool,
    },
  };
}

export class OpenClawAgentSession {
  private readonly adapter;
  private readonly engine: AgentSessionConstructorArgs["config"]["engine"];
  private readonly sessionId: string;
  readonly hasOrphanedInjections = false;
  readonly mode: AgentSessionConstructorArgs["sessionContext"]["mode"];

  constructor({ config, buildSystemPrompt, sessionContext }: AgentSessionConstructorArgs) {
    this.engine = config.engine;
    this.mode = sessionContext.mode;
    this.sessionId = loadSessionId(this.mode, config.engine) ?? randomUUID();
    const sdk = getOpenClawSdk();
    const compat = getOpenClawVisionClawCompat();
    const sessionFile = resolveOpenClawTranscriptPath(this.mode, this.sessionId);

    this.adapter = compat.createVisionClawSessionAdapter(
      buildOpenClawSessionAdapterArgs({
        mode: this.mode,
        profileId: getProfile(),
        sessionId: this.sessionId,
        systemPrompt: renderSystemPrompt(buildSystemPrompt()),
        modelRef: getModelId(config as OpenClawVisionClawConfig),
        sessionFile,
        authProfileId: (config as OpenClawVisionClawConfig).openclaw.authProfileId,
        rawEventLogPath: (config as OpenClawVisionClawConfig).openclaw.rawEventLogEnabled
          ? resolveOpenClawRawEventLogPath()
          : undefined,
        dualSessionEnabled: sessionContext.getDualSessionEnabled(),
        executeHostTool: (toolName, input) =>
          executeOpenClawHostedToolCall(toolName, input, {
            dualSessionEnabled: sessionContext.getDualSessionEnabled(),
          }),
      }),
    );
  }

  sendAndStream(content: unknown): AsyncIterable<AgentStreamMessage> {
    return this.adapter.sendAndStream(content as never) as AsyncIterable<AgentStreamMessage>;
  }

  injectMessage(content: unknown): boolean {
    return this.adapter.injectMessage(content as never);
  }

  closeInput(): void {
    this.adapter.closeInput();
  }

  requestStop(): void {
    this.adapter.requestStop();
  }

  clearStop(): void {
    this.adapter.clearStop();
  }

  isStopRequested(): boolean {
    return this.adapter.isStopRequested();
  }

  requestCompaction(): Promise<void> {
    return this.adapter.requestCompaction();
  }

  maybeCompactByTokens(options?: {
    usedPctThreshold?: number;
    cooldownMs?: number;
  }): Promise<void> {
    return this.adapter.maybeCompactByTokens(options);
  }

  captureSessionId(id: string | undefined): void {
    this.adapter.captureSessionId(id);
    if (id) {
      saveSessionId(id, this.mode, this.engine);
    }
  }

  captureUsageSnapshot(snapshot: {
    usedInputTokens: number;
    contextWindow: number;
    usedPct: number;
    capturedAtMs?: number;
  }): void {
    const normalized = toHostUsageSnapshot(snapshot);
    if (normalized) {
      saveUsageSnapshot(normalized, this.mode, this.engine);
    }
  }

  capturePostCompactionSnapshot(postCompactionTokens: number): void {
    this.adapter.capturePostCompactionSnapshot(postCompactionTokens);
  }

  getSessionId(): string | null {
    return this.adapter.getSessionId();
  }

  getTranscriptPath(): string | null {
    return this.adapter.getTranscriptPath();
  }

  getUsageSnapshot() {
    return toHostUsageSnapshot(this.adapter.getUsageSnapshot());
  }

  getCurrentQuery(): CurrentQueryLike | null {
    return this.adapter.getCurrentQuery();
  }

  setDynamicMcpServers(servers: Record<string, Record<string, unknown>>): void {
    this.adapter.setDynamicMcpServers(servers);
  }

  getDynamicMcpServers(): Record<string, Record<string, unknown>> {
    return this.adapter.getDynamicMcpServers();
  }

  get isInputClosed(): boolean {
    return this.adapter.isInputClosed;
  }
}
```

- [ ] **Step 4: Run the unit and integration tests for the thin wrapper**

Run:

```bash
cd /Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk
pnpm exec vitest run \
  tests/unit/agent/openclaw-sdk-loader.test.ts \
  tests/unit/agent/openclaw-session-adapter.test.ts \
  tests/integration/openclaw-thin-host.test.ts
```

Expected: PASS. The host now loads the compat module lazily and delegates OpenClaw-specific protocol semantics to the SDK.

- [ ] **Step 5: Commit the thin-host refactor**

Run:

```bash
SDK_SHA="$(git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk rev-parse HEAD)"
VC_ROOT="/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk"
git -C "$VC_ROOT" add src/agent/providers/openclaw tests/unit/agent tests/integration/openclaw-thin-host.test.ts
git -C "$VC_ROOT" commit \
  -m "refactor: thin the openclaw visionclaw host bridge" \
  -m "Spec: docs/superpowers/specs/2026-03-27-openclaw-agent-sdk-design.md" \
  -m "Phase: phase-4-thin-host" \
  -m "OpenClaw-Agent-SDK-SHA: $SDK_SHA"
```

Expected: the host still owns package loading and host tools, but no longer permanently owns OpenClaw event normalization or duplicated OpenClaw SDK types.

### Task 5: Keep Continuity Host-Owned And Re-Verify Packaging, Regression, And Push Order

**Files:**
- Create: `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/tests/unit/agent/conversation-journal.test.ts`
- Modify: `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/tests/unit/config/index.test.ts`
- Modify: `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/scripts/stage-openclaw-agent-sdk.mjs`
- Modify: `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/tests/integration/openclaw-thin-host.test.ts`

- [ ] **Step 1: Write the failing continuity and packaging regression tests**

```ts
// /Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/tests/unit/agent/conversation-journal.test.ts
import { describe, expect, it } from "vitest";
import {
  appendConversationJournalEntryForEngine,
  buildCrossEngineContinuationText,
} from "../../../src/agent/conversation-journal.js";
import { loadContinuationCursor } from "../../../src/config/index.js";

describe("conversation journal", () => {
  it("preserves exact tool names and updates engine-scoped continuation cursors", () => {
    const seq = appendConversationJournalEntryForEngine("general", "claude-agent-sdk", {
      kind: "tool_call",
      toolName: "exec",
      input: { command: "pwd" },
      timestamp: "2026-03-27T00:00:00.000Z",
    });

    const continuation = buildCrossEngineContinuationText({
      mode: "general",
      afterSeq: 0,
    });

    expect(seq).toBeGreaterThan(0);
    expect(continuation.text).toContain("Tool call: exec");
    expect(loadContinuationCursor("general", "claude-agent-sdk")).toBe(seq);
  });
});
```

```ts
// Append to /Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/tests/integration/openclaw-thin-host.test.ts
import fs from "node:fs";
import path from "node:path";

it("stages the compat/visionclaw build artifact into the packaged vendor runtime", () => {
  const compatEntrypoint = path.join(
    process.cwd(),
    "dist",
    "vendor",
    "openclaw-agent-sdk",
    "dist",
    "compat",
    "visionclaw",
    "index.js",
  );
  expect(fs.existsSync(compatEntrypoint)).toBe(true);
});
```

- [ ] **Step 2: Run the regression tests and verify at least one fails before the final wiring**

Run:

```bash
cd /Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk
pnpm exec vitest run \
  tests/unit/agent/conversation-journal.test.ts \
  tests/integration/openclaw-thin-host.test.ts \
  tests/integration/session-manager.test.ts \
  tests/integration/stream-handler.test.ts \
  tests/integration/claude-sdk.test.ts
```

Expected: at least one failure appears until the final packaging and regression wiring is complete.

- [ ] **Step 3: Ensure staging copies the full SDK `dist` tree, including `compat/visionclaw`**

```js
// /Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk/scripts/stage-openclaw-agent-sdk.mjs
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const sdkRoot = join(root, "packages", "openclaw-agent-sdk");
const stageRoot = join(root, "dist", "vendor", "openclaw-agent-sdk");

if (!existsSync(sdkRoot)) {
  throw new Error(`missing SDK submodule: ${sdkRoot}`);
}

execFileSync("pnpm", ["--dir", sdkRoot, "install"], { stdio: "inherit" });
execFileSync("pnpm", ["--dir", sdkRoot, "run", "build"], { stdio: "inherit" });

mkdirSync(stageRoot, { recursive: true });
cpSync(join(sdkRoot, "dist"), join(stageRoot, "dist"), { recursive: true });
cpSync(join(sdkRoot, "package.json"), join(stageRoot, "package.json"));
```

- [ ] **Step 4: Run the full end-to-end verification suite**

Run:

```bash
cd /Users/apple/programme/funny_projects/openclaw_agent_sdk
pnpm run check
pnpm run test
pnpm run build
pnpm run test:e2e

cd /Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk
pnpm exec vitest run \
  tests/unit/agent/openclaw-sdk-loader.test.ts \
  tests/unit/agent/openclaw-session-adapter.test.ts \
  tests/unit/agent/conversation-journal.test.ts \
  tests/unit/config/index.test.ts \
  tests/integration/openclaw-thin-host.test.ts \
  tests/integration/session-manager.test.ts \
  tests/integration/stream-handler.test.ts \
  tests/integration/claude-sdk.test.ts
pnpm run build
```

Expected: all SDK checks PASS, all targeted VisionClaw tests PASS, `dist/vendor/openclaw-agent-sdk/dist/compat/visionclaw/index.js` exists, and Claude remains unaffected when OpenClaw is not selected.

- [ ] **Step 5: Commit and push the final VisionClaw realignment**

Run:

```bash
SDK_SHA="$(git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk rev-parse HEAD)"
VC_ROOT="/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk"
git -C "$VC_ROOT" add src tests scripts package.json .gitmodules packages/openclaw-agent-sdk
git -C "$VC_ROOT" commit \
  -m "feat: consume openclaw sdk through thin compat host" \
  -m "Spec: docs/superpowers/specs/2026-03-27-openclaw-agent-sdk-design.md" \
  -m "Phase: phase-5-thin-host-hardening" \
  -m "OpenClaw-Agent-SDK-SHA: $SDK_SHA"
git -C "$VC_ROOT" push -u origin HEAD
```

Expected: the pushed VisionClaw branch points at a remote-reachable SDK SHA, preserves host-owned continuity state, stages the compat artifact for packaging, and keeps non-selected engines free from OpenClaw runtime side effects.

## Rollout Checklist

- SDK order:
  - finish Tasks 1 and 2 in `/Users/apple/programme/funny_projects/openclaw_agent_sdk`
  - push the SDK SHA first
  - verify remote reachability with `git ls-remote`
- VisionClaw order:
  - update the submodule pointer in `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk`
  - keep `sdk-loader.ts`, `host-tools.ts`, `persistence.ts`, `conversation-journal.ts`, and `config/index.ts` host-owned
  - remove or collapse `sdk-types.ts` and `event-normalizer.ts`
- Rollback order:
  - revert the bad SDK commit in `babelcloud/openclaw-agent-sdk` first if the defect is SDK-only
  - then repin the VisionClaw submodule to the last-known-good SDK SHA
  - use `git revert`, never force-push shared history
