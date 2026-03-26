# OpenClaw Agent SDK Design Spec

Date: 2026-03-27
Location: `/Users/apple/programme/funny_projects/openclaw_agent_sdk`
Status: Draft for review
Primary host target: `/Users/apple/programme/funny_projects/visionclaw_repo`

## 1. Goal

Build a standalone **OpenClaw Agent SDK** that extracts the embeddable agent execution kernel from OpenClaw, preserves as much of OpenClaw's tools/plugin/runtime behavior as is safe in embedded mode, and makes it pluggable inside VisionClaw as a third SDK family alongside:

1. Claude Agent SDK
2. OpenAI Agent SDK
3. OpenClaw Agent SDK

The OpenClaw Agent SDK is not a new channel system, not a new gateway, and not a replacement for VisionClaw's outer orchestration. It is a third execution backend.

## 2. Requirements Locked By This Spec

### 2.1 Functional requirements

- VisionClaw must be able to select `claude-agent-sdk`, `openai-agent-sdk`, or `openclaw-agent-sdk` explicitly.
- OpenClaw Agent SDK must support many model providers through OpenClaw's existing model/provider/auth stack rather than through VisionClaw's current narrow `provider` enum.
- OpenClaw Agent SDK must preserve OpenClaw-specific execution behavior where practical:
  - embedded runner lifecycle
  - tool policy pipeline
  - OpenClaw coding tools
  - plugin loading and hook execution
  - provider failover and auth profile logic
  - stream/reasoning/tool event richness
- OpenClaw Agent SDK must preserve execution-layer semantics rather than flattening them into plain text or host-only callbacks:
  - `tool_call` identity and ordering
  - explicit hosted-tool suspend/resume boundaries
  - `tool_result` / `tool_error` continuity
  - stop and compaction behavior
- The host-facing integration contract must stay session-first. VisionClaw may bootstrap the SDK asynchronously, but it must not adopt a second top-level "agent runtime platform" abstraction just for OpenClaw.
- VisionClaw must remain the outer orchestrator:
  - wake loop
  - channel ingress/egress
  - dual-session switching
  - owner notifications
  - top-level profile directory

### 2.2 Persistence requirements

- **Canonical session state remains unified in VisionClaw.**
- OpenClaw Agent SDK must not introduce a second authoritative session registry such as a parallel `sessions.json` that independently allocates or owns session identity.
- OpenClaw Agent SDK may emit provider-specific artifacts, but they must be rooted under the active VisionClaw profile directory and keyed by the canonical VisionClaw session id.

### 2.3 Integration requirements

- OpenClaw Agent SDK development happens in `/Users/apple/programme/funny_projects/openclaw_agent_sdk`.
- Today that path is a bootstrap working directory nested under `/Users/apple/programme/funny_projects`; Phase 0 must turn it into an independent git repository whose npm package name is `openclaw-agent-sdk`.
- The canonical SDK git remote must live under the BabelCloud enterprise GitHub organization as `https://github.com/babelcloud/openclaw-agent-sdk.git` once provisioned.
- The sibling repository `/Users/apple/programme/funny_projects/openclaw-agent-sdk` is reference material only for this project and must not become the runtime dependency or source-of-truth implementation.
- After Phase 0 bootstrap, VisionClaw consumes this repository as a dedicated submodule with minimal necessary host-side changes.
- VisionClaw must only point its submodule at commits that have already been pushed to the BabelCloud remote. Local-only SHAs are forbidden.
- VisionClaw must not import raw source from the full upstream OpenClaw repository at runtime.
- OpenClaw engine support is opt-in only in phase 1. Existing VisionClaw installs must continue to default to Claude/OpenAI engines unless an operator explicitly selects `openclaw-agent-sdk`.

## 3. Non-Goals

- Do not embed the full OpenClaw gateway, control UI, HTTP/WS server, cron daemon, channel manager, or node host.
- Do not move VisionClaw onto OpenClaw's session store, channel system, or gateway lifecycle.
- Do not attempt full feature parity with every OpenClaw channel plugin in phase 1.
- Do not widen VisionClaw's existing Claude/OpenAI paths unless required for the new pluggable engine abstraction.

## 4. Source Architecture Facts This Spec Relies On

### 4.1 VisionClaw facts

- VisionClaw's true runtime seam is `AgentSessionLike` in `src/agent/providers/session-types.ts`.
- `SessionManager` creates engine-specific session implementations and drives general/coding switching.
- `processAgentStream()` consumes normalized `assistant | user(tool_result) | result | system` messages and contains host behavior for:
  - `finish`
  - `switch_session`
  - `TodoWrite`
  - compaction boundaries
- Claude path is interruptible and transcript-driven.
- OpenAI path already proves that a non-Claude engine backend can normalize a foreign stream model into VisionClaw's shared contract.
- Current VisionClaw config couples engine choice to model family. That must be refactored because OpenClaw Agent SDK is a third SDK family, not just a new `provider`.

### 4.2 OpenClaw facts

- The embeddable boundary is the embedded runner path centered on `runEmbeddedPiAgent()`, not the gateway.
- OpenClaw's heavy execution path depends on:
  - embedded runner
  - Pi `SessionManager`
  - context-engine bootstrap/finalize lifecycle
  - OpenClaw coding tools
  - tool policy pipeline
  - plugin loader and hook runner
  - session/transcript management
  - model/auth/failover stack
- The current host-owned tool seam is the embedded runner's `clientTools` / pending-tool-call path, not silent in-process callbacks.
- OpenClaw plugin authors depend on `openclaw/plugin-sdk/*` subpaths.
- OpenClaw's default runtime expects its own state/config/session paths. Embedded mode must override those.

## 5. Target Architecture

### 5.1 High-level split

The final system has three layers:

1. **VisionClaw host**
   - owns wake loop, owner/channel context, dual-session mailbox, canonical session persistence, top-level logs

2. **OpenClaw Agent SDK**
   - owns the extracted OpenClaw execution kernel: embedded runner, tool/plugin semantics, event normalization, provider-specific transcript/raw-event artifacts, and embedded-mode policy

3. **Upstream OpenClaw source snapshot**
   - used as the reference source for extraction/sync, but not imported at runtime by VisionClaw

### 5.2 Core decision

OpenClaw Agent SDK will be a **session-first extracted agent kernel**, not a repackaged gateway and not a second host-owned runtime platform.

The host-facing API is a session factory plus session objects. If the SDK needs one-time bootstrap for plugin registry, context-engine lifecycle, or provider/auth initialization, that bootstrap remains a private SDK implementation detail behind the factory boundary.

The SDK will wrap and adapt the following OpenClaw subsystems:

- embedded runner
- Pi session and streaming adapter
- context-engine lifecycle
- OpenClaw tools and tool policies
- plugin loader/hook runner
- model/provider/auth/failover resolution
- selected plugin-sdk compatibility surfaces

The SDK will **not** expose the full gateway bootstrap or channel stack as part of the embedded path.

### 5.3 SDK vs environment responsibility split

The architecture must explicitly distinguish SDK work from environment work.

**SDK-level responsibilities**

- create and reuse agent sessions
- preserve execution-layer semantics:
  - stream events
  - reasoning deltas
  - `tool_call` / `tool_result` / `tool_error`
  - hosted-tool suspend/resume
  - stop and compaction
- adapt OpenClaw model/provider/auth resolution for embedded execution
- enforce embedded tool policy and plugin policy
- emit host-rooted provider artifacts only

**Environment-level responsibilities**

- profile/config/state roots
- credentials injection and environment variables
- external MCP server definition and process launch
- wake loop, owner/channel routing, dual-session mailbox, and canonical `session.json`
- OS/browser/desktop prerequisites
- packaging, submodule wiring, SCM governance, and rollback

VisionClaw's existing `RuntimeSurface` remains an environment capability descriptor. It is not evidence that VisionClaw should adopt a second embedded agent runtime abstraction for OpenClaw.

### 5.4 Failure-containment rule

OpenClaw SDK kernel code must be isolated behind a single engine-gated loader path.

- If `engine !== "openclaw-agent-sdk"`, VisionClaw must not initialize OpenClaw runtime state, load OpenClaw plugins, touch OpenClaw config/auth paths, or pay OpenClaw bootstrap cost.
- OpenClaw integration must not rely on top-level side-effect imports in shared startup paths.
- If the selected engine is `openclaw-agent-sdk` and runtime bootstrap fails, VisionClaw must fail loudly with an actionable startup/session error.
- Silent fallback from OpenClaw to Claude/OpenAI is forbidden because it would change tool semantics and hide operator-visible faults.

## 6. Repository Structure For `openclaw_agent_sdk`

The target bootstrap directory currently contains only this spec. Phase 0 converts it into a standalone git repo/package named `openclaw-agent-sdk`.

The target structure is:

```text
openclaw_agent_sdk/
  docs/
    superpowers/
      specs/
        2026-03-27-openclaw-agent-sdk-design.md
  manifests/
    upstream-provenance.json
  package.json
  tsconfig.json
  src/
    index.ts
    public/
      sdk.ts
      session.ts
      types.ts
      events.ts
      host-tools.ts
      persistence.ts
    core/
      embedded-runner/
      tools/
      plugins/
      models/
      auth/
      sessions/
      transcripts/
      logging/
      normalization/
      compat/
    upstream/
      openclaw/
        ... # extracted subset only; never a full mirror of the upstream repo
  tests/
    unit/
    contract/
    integration/
    fixtures/
  scripts/
    sync-from-openclaw.mjs
    verify-upstream-snapshot.mjs
```

### 6.1 Boundary rule

- `src/public/*` is the only supported SDK surface.
- `src/upstream/openclaw/*` contains only the extracted/adapted upstream subset required by the SDK and must not be imported directly by VisionClaw.
- Mirroring the full `/Users/apple/programme/funny_projects/openclaw` repository inside this SDK is explicitly forbidden.
- Every extracted upstream file must have a provenance entry in `manifests/upstream-provenance.json`.
- Every public export must be backed by contract tests.

## 7. Public SDK API

The SDK public API must be generic and host-agnostic, but designed so VisionClaw can wrap it with minimal glue. The public surface is session-first. Any internal bootstrap state remains private to the SDK and does not become a new host architecture layer.

### 7.1 Top-level API

```ts
export interface OpenClawAgentSdkOptions {
  workspaceDir: string;
  stateDir: string;
  agentDir: string;
  profileId: string;
  pluginMode: "disabled" | "allowlisted" | "full-embedded";
  enabledPluginIds?: string[];
  logger: OpenClawHostLogger;
  sessionStore: OpenClawSessionStoreAdapter;
  hostedTools?: OpenClawHostedToolDefinition[];
  env?: Record<string, string | undefined>;
}

export interface OpenClawAgentSdk {
  createSession(params: OpenClawSessionParams): OpenClawAgentSession;
  shutdown(): Promise<void>;
}

export function createOpenClawAgentSdk(
  options: OpenClawAgentSdkOptions,
): Promise<OpenClawAgentSdk>;
```

### 7.2 Session API

```ts
export interface OpenClawSessionIdentity {
  mode: "general" | "coding";
  sessionId: string;
  sessionKey: string;
}

export interface OpenClawSessionParams {
  identity: OpenClawSessionIdentity;
  systemPrompt: string;
  modelRef: string;
  sessionFile: string;
  authProfileId?: string;
  rawEventLogPath?: string;
}

export interface OpenClawCurrentQueryLike {
  mcpServerStatus?(): Promise<unknown>;
  toggleMcpServer?(serverName: string, enabled: boolean): Promise<void>;
}

export interface OpenClawAgentSession {
  streamTurn(input: OpenClawTurnInput): AsyncIterable<OpenClawStreamEvent>;
  injectMessage(input: OpenClawTurnInput): boolean;
  submitHostedToolResult(input: OpenClawHostedToolResultInput): AsyncIterable<OpenClawStreamEvent>;
  submitHostedToolError(input: OpenClawHostedToolErrorInput): AsyncIterable<OpenClawStreamEvent>;
  requestStop(): void;
  clearStop(): void;
  isStopRequested(): boolean;
  requestCompaction(): Promise<void>;
  maybeCompactByTokens(options?: OpenClawCompactionOptions): Promise<void>;
  getSessionId(): string;
  getTranscriptPath(): string | null;
  getUsageSnapshot(): OpenClawUsageSnapshot | null;
  getCurrentQuery(): OpenClawCurrentQueryLike | null;
  setDynamicMcpServers(servers: Record<string, Record<string, unknown>>): void;
  getDynamicMcpServers(): Record<string, Record<string, unknown>>;
  closeInput(): void;
}
```

`mcpServerStatus()` and `toggleMcpServer()` are optional because VisionClaw's current `manage_mcp_servers` tool can already degrade to persisted-next-wake semantics when a live session cannot report status or toggle a running server. For the OpenClaw engine, correctness of persisted add/remove/list behavior is mandatory; live mid-run toggle support is best-effort unless the implementation can prove equivalent semantics.

### 7.3 Event contract

The SDK emits its own normalized stream event contract, then VisionClaw's provider adapter translates that 1:1 into `AgentStreamMessage`.

This indirection is intentional. It keeps OpenClaw Agent SDK generic and makes VisionClaw-specific `finish`, `switch_session`, `TodoWrite`, and log semantics an adapter concern rather than a core SDK concern.

`createOpenClawAgentSdk()` is the only allowed async bootstrap boundary. VisionClaw must complete that bootstrap before constructing `SessionManager`; individual session creation and `injectMessage()` acceptance must remain synchronous because the current host contract branches on those return values inline.

Minimum `OpenClawStreamEvent` kinds in v1:

- `assistant_delta`
- `reasoning_delta`
- `reasoning_end`
- `tool_call`
- `tool_result`
- `tool_error`
- `hosted_tool_call`
- `usage_snapshot`
- `compaction_started`
- `compaction_finished`
- `turn_complete`

Hosted-tool calls are explicit events, not silent in-process callbacks. In v1, the SDK may expose at most one pending hosted-tool call per turn because the current embedded runner only surfaces a single pending client-tool request.

Important source-reality note:

- Upstream OpenClaw currently surfaces client-hosted tool invocations as a run result with `stopReason = "tool_calls"` plus `pendingToolCalls`, not as a native long-lived callback object.
- The SDK may normalize that upstream seam into a `hosted_tool_call` event for VisionClaw, but the spec must not assume the upstream embedded runner natively emits that exact public event shape.

The following semantics are mandatory and must survive SDK normalization plus VisionClaw adaptation:

- `tool_call` and `hosted_tool_call` remain first-class execution events, not text substitutions.
- Every tool event carries a stable `callId`; `tool_result` / `tool_error` must reference the originating `callId`.
- `hosted_tool_call` preserves a real suspend/resume boundary; VisionClaw must not auto-resume without an explicit result or error submission.
- Event ordering within a turn must remain deterministic enough for transcript replay and duplicate-call detection.

## 8. Host Tool Model

### 8.1 Rule

OpenClaw Agent SDK must preserve OpenClaw's native tools and plugin-owned tools **and** allow the host to provide VisionClaw-only tools through an explicit hosted-tool protocol.

The hosted-tool bridge is part of the execution contract. It must preserve `callId`, tool input, result/error channel, and resume ordering.

### 8.2 Mandatory host tool bridge in phase 1

The embedded VisionClaw provider bridge must expose hosted tools for at least:

- `finish`
- `notify_user`
- `switch_session`
- `memory`
- `manage_skills`
- `manage_mcp_servers`

Phase-1 hosted-tool protocol:

1. SDK emits `hosted_tool_call` with at least `callId`, `toolName`, and `input`.
2. VisionClaw executes the matching host tool and treats that `callId` as the durable resume key.
3. VisionClaw resumes the same logical OpenClaw turn/session continuation via `submitHostedToolResult()` or `submitHostedToolError()` using the same `callId`.
4. The SDK emits the corresponding continuation events without losing `callId` continuity.

Phase 1 must not model these as silent in-process callbacks unless the implementation can prove it preserves the same stop/retry/persistence semantics as the embedded runner's current client-tool path.

### 8.3 Phase 2 host tool bridge

Add host bridges for VisionClaw-specific domain tools where OpenClaw does not already provide an acceptable equivalent:

- `manage_calendar`
- `manage_email`
- `manage_drive`
- `upgrade`
- browser/desktop automation compatibility where OpenClaw's native tools do not match VisionClaw's runtime expectations

### 8.4 Default OpenClaw tool policy in embedded mode

Enabled by default:

- coding tools
- read/write/edit/apply_patch
- exec/process tools subject to host policy
- OpenClaw provider/model tools
- allowlisted plugin tools

Disabled by default in embedded VisionClaw mode:

- gateway lifecycle tools
- channel setup/lifecycle tools
- message delivery tools that bypass VisionClaw routing
- cron/node host/gateway session tools unless explicitly re-enabled by the host
- `message`
- `gateway`
- `cron`
- `nodes`
- all `sessions_*` tools
- `subagents`

This deny profile must be enforced before session creation, not left to ad hoc downstream policy configuration. It is required to avoid OpenClaw taking ownership of host responsibilities that VisionClaw already owns.

## 9. Plugin Strategy

### 9.1 Goal

Preserve OpenClaw's plugin and hook system as much as possible in embedded mode.

### 9.2 Embedded-mode plugin contract

The SDK must define an embedded plugin mode with these rules:

- plugin loading lives in a single process-global plugin realm
- plugin config roots are redirected under the host-provided `stateDir`
- plugins may register tools and hooks
- plugins may not start gateway/channel/server processes in embedded mode
- plugin runtime gets a host capability object that clearly marks unavailable surfaces
- `allowlisted` is the default production mode and must be closed-world: only explicit `enabledPluginIds` may load
- `full-embedded` is trusted-dev / explicit-opt-in only because upstream plugin discovery can auto-load local plugins when the allowlist is empty

### 9.3 Compatibility package

To preserve OpenClaw plugin compatibility, the SDK repo must ship an embedded compatibility surface for:

- `openclaw/plugin-sdk`
- selected stable `openclaw/plugin-sdk/*` subpaths

This compatibility layer lives inside the SDK/runtime alias map used by the embedded plugin loader. It does **not** replace VisionClaw's existing `packages/openclaw-sdk-shim` in phase 1.

This does **not** mean the entire upstream package root becomes public. Only an explicit allowlist of stable subpaths may be exported.

## 10. Session, Transcript, And Log Persistence

This is the most important persistence rule in the entire design.

### 10.1 Canonical session truth

VisionClaw remains the only owner of canonical session state:

- session ids by mode
- active mode
- usage snapshot cache
- mailbox/memo state

In concrete terms, the authoritative file remains VisionClaw's profile-scoped `session.json`.

### 10.2 OpenClaw embedded identity mapping

For each VisionClaw mode:

- `sessionId`: reuse the canonical VisionClaw session id
- `sessionKey`: derive deterministic stable keys:
  - `visionclaw:<profile>:general`
  - `visionclaw:<profile>:coding`

OpenClaw Agent SDK must never generate a fresh long-lived session identity when the host already provided one.

### 10.3 Allowed provider-specific artifacts

Provider-specific artifacts are allowed under:

```text
~/.visionclaw/profiles/<profile>/providers/openclaw/
```

Planned subpaths:

```text
providers/openclaw/
  transcripts/
    general/<sessionId>.jsonl
    coding/<sessionId>.jsonl
  raw-stream/
    YYYY-MM-DD.jsonl
  tools/
  plugins/
  cache/
  embedded/
```

These are artifacts, not authoritative session ownership.

### 10.4 Explicit prohibition

In VisionClaw embedded mode, OpenClaw Agent SDK must not write authoritative runtime state to:

- `~/.openclaw`
- standalone `sessions.json`
- standalone config roots outside the active VisionClaw profile
- fallback `resolveOpenClawAgentDir()` roots outside the host-provided embedded `agentDir`

If upstream OpenClaw code assumes those paths, the SDK extraction must replace them with injected adapters.

The SDK must not call upstream helpers such as default `resolveStateDir()` / `resolveOpenClawAgentDir()` / `ensureOpenClawAgentEnv()` in a way that can silently reintroduce `~/.openclaw` or default agent-directory fallback when the host already supplied explicit roots.

The SDK must also not rely on ambient import-time environment snapshots for path ownership. In particular, embedded path resolution must not be derived from process-global `OPENCLAW_STATE_DIR` / `OPENCLAW_AGENT_DIR` constants captured during module import, because VisionClaw already uses `OPENCLAW_STATE_DIR` for other OpenClaw-adjacent vendor code at the profile root.

### 10.5 Host session persistence adapter

The SDK must introduce an internal persistence seam:

```ts
export interface OpenClawSessionStoreAdapter {
  load(identity: OpenClawSessionIdentity): Promise<OpenClawStoredSession | null>;
  save(identity: OpenClawSessionIdentity, value: OpenClawStoredSession): Promise<void>;
  resolveSessionFile(identity: OpenClawSessionIdentity): Promise<string>;
}
```

VisionClaw will provide an adapter backed by its existing profile/session state instead of allowing OpenClaw internals to allocate their own store.

`load()` / `save()` are host metadata persistence seams only. They do **not** replace Pi transcript/session-manager state.

`resolveSessionFile(identity)` is the mandatory Pi transcript/session-manager path seam for embedded mode.

The SDK must preserve the upstream `prepareSessionManagerForRun()` behavior, or an equivalent normalization, so a pre-created `sessionFile` does not lose the initial user prompt before the first assistant flush.

### 10.6 Log strategy

There are two log classes:

1. **Host logs**
   - continue to go through VisionClaw `logger.ts`
   - remain the canonical top-level operational log

2. **Provider raw/runtime artifacts**
   - optional
   - written under `providers/openclaw/raw-stream/`
   - intended for provider debugging, replay, and parity checks

OpenClaw Agent SDK must expose its internal logs as structured callbacks first. Direct disk writes are secondary and must be host-rooted.

Host logs are the only canonical operator-facing session log. Provider raw/runtime artifacts must never become the only source of truth for rendered system prompts or tool execution history.

### 10.6.1 Canonical host log requirements

For every top-level query start, VisionClaw's OpenClaw provider must emit exactly one canonical host `system_prompt` record before the first assistant/tool/result event for that query.

- The entry must contain the fully rendered prompt text after preset expansion plus append/replace resolution.
- The host-log `message` field stores that prompt as a single line with literal `\n` escapes, matching current VisionClaw Claude/OpenAI behavior.
- Hosted-tool resume of an already-started query must not emit a second `system_prompt` record unless the provider has actually started a new top-level query.

Tool execution records in host logs must remain shape-compatible with existing VisionClaw logger categories:

- `tool_call`
  - `message = toolName`
  - `data.name = toolName`
  - `data.input = tool args`
  - `data.tool_use_id = stable call id` when available
- `tool_result`
  - `message = summarized tool output or error text`
  - `data.name = toolName`
  - `data.tool_use_id = stable call id` when available
  - tool errors continue to be represented through `data.is_error = true` rather than inventing a new top-level VisionClaw host-log category
- subagent correlation continues to use existing `parent_tool_use_id`, `subagent_type`, and `subagent_agent_id` fields when applicable

Provider-specific metadata such as upstream `stopReason`, `pendingToolCalls`, raw payload fragments, and `systemPromptReport` may be written to `providers/openclaw/raw-stream/` or debug callbacks, but they do not satisfy or replace the canonical host `system_prompt` / `tool_call` / `tool_result` records.

### 10.7 Required logger adapter

```ts
export interface OpenClawLogEvent {
  category:
    | "system_prompt"
    | "tool_call"
    | "tool_result"
    | "assistant"
    | "system"
    | "provider_debug";
  message: string;
  data?: Record<string, unknown>;
}

export interface OpenClawHostLogger {
  onDebug(event: OpenClawLogEvent): void;
  onInfo(event: OpenClawLogEvent): void;
  onWarn(event: OpenClawLogEvent): void;
  onError(event: OpenClawLogEvent): void;
  onRawStreamEvent?(event: Record<string, unknown>): void;
}
```

VisionClaw's provider bridge will map these events to existing logger categories and optional raw-stream files.

The OpenClaw VisionClaw adapter must map canonical `system_prompt`, `tool_call`, and `tool_result` events into VisionClaw's existing `logger.ts` categories instead of only forwarding provider-native metadata through `onRawStreamEvent()`. `systemPromptReport` is metadata for raw/debug artifacts only and is not a substitute for the canonical host `system_prompt` entry.

## 11. VisionClaw Integration Design

### 11.1 New engine abstraction

VisionClaw must stop inferring engine family from model family alone.

Add a new top-level configuration field:

```ts
engine: "claude-agent-sdk" | "openai-agent-sdk" | "openclaw-agent-sdk"
```

### 11.2 Config migration rule

- VisionClaw config becomes engine-discriminated rather than treating `model` + `provider` as globally authoritative.
- Existing configs without `engine` are migrated automatically:
  - Claude models -> `claude-agent-sdk`
  - `gpt-5.4` -> `openai-agent-sdk`
- When `engine === "openclaw-agent-sdk"`, `openclaw.modelRef` is authoritative. Top-level `model` and `provider` must not be read for runtime selection and should not remain required in that config branch.
- `openclaw-agent-sdk` uses a new nested config block instead of exploding the current `ProviderSchema`.

### 11.3 OpenClaw-specific config block

```ts
openclaw: {
  modelRef: string;
  authProfileId?: string;
  pluginMode: "disabled" | "allowlisted" | "full-embedded";
  enabledPluginIds?: string[];
  rawEventLogEnabled?: boolean;
}
```

Rationale:

- minimal intrusion to current Claude/OpenAI config
- avoids turning VisionClaw's narrow provider enum into a clone of OpenClaw's provider catalog
- lets OpenClaw continue to resolve `provider/model` pairs via `modelRef`

For this engine, `modelRef` is the only authoritative model selector.

### 11.4 New VisionClaw provider files

Add:

```text
src/agent/providers/engine.ts
src/agent/providers/openclaw/
  session.ts
  sdk-loader.ts
  sdk-factory.ts
  event-normalizer.ts
  host-tools.ts
  persistence.ts
```

Responsibilities:

- `engine.ts`: central engine selection, runtime labeling, and config helpers; keep Claude/OpenAI client setup separate from OpenClaw runtime setup
- `session.ts`: `OpenClawAgentSession implements AgentSessionLike`, including synchronous injection gating, hosted-tool continuation, tool-call identity preservation, prompt normalization, once-per-top-level-query host `system_prompt` audit emission, dynamic MCP server state, `getCurrentQuery()` bridging, and safe handling of accepted-but-undelivered injections when live interrupt support exists
- `sdk-loader.ts`: the only host module allowed to dynamically import the SDK; caches the loaded module and guarantees no OpenClaw bootstrap work occurs unless the engine is selected
- `sdk-loader.ts`: the only host module allowed to dynamically import the SDK; caches the loaded module, guarantees no OpenClaw bootstrap work occurs unless the engine is selected, and prevents ambient env-derived path constants from being snapshotted before embedded path adapters are established
- `sdk-factory.ts`: minimal SDK factory singleton, process-global plugin prewarm/activation if required, state dir wiring, host-rooted `agentDir` injection, logger injection
- `event-normalizer.ts`: OpenClaw SDK event -> `AgentStreamMessage`, including normalization of native and hosted tool activity into the `assistant.tool_use` / `user.tool_result` shapes that VisionClaw's existing `processAgentStream()` contract expects
- `host-tools.ts`: VisionClaw hosted-tool definitions plus result/error resume helpers
- `persistence.ts`: adapter between VisionClaw profile/session store and SDK persistence interface

### 11.5 Existing VisionClaw files to modify

- `src/config/types.ts`
  - add `EngineSchema`
  - convert config to an engine-discriminated union
  - add `openclaw` schema
  - add migration helpers

- `src/config/index.ts`
  - preserve legacy config auto-migration when `engine` is absent
  - stop reading top-level `model` / `provider` for the OpenClaw engine branch

- `src/agent/loop.ts`
  - asynchronously bootstrap the OpenClaw SDK factory before constructing `SessionManager`, but only when the selected engine is `openclaw-agent-sdk`
  - keep existing Claude/OpenAI startup order intact

- `src/reconfigure.ts`
  - engine-first selection flow
  - OpenClaw engine-specific prompts

- `src/onboarding/*`
  - optional later phase; first phase may leave OpenClaw setup to manual config

- `src/agent/session-manager.ts`
  - replace `isGptModel()` binary split with `engine`-based runtime selection
  - replace Claude-only prompt branching with engine-aware prompt resolution
  - ensure OpenClaw receives rendered string prompts rather than the Claude `preset: "claude_code"` path
  - ensure non-selected engines do not import or initialize OpenClaw runtime code paths

- `src/agent/runtime-surface.ts`
  - decouple tool transport from `config.model === "gpt-5.4"`
  - add a third `visionClawToolTransport.transport` kind: `openclaw-embedded`
  - define external MCP / dynamic-server semantics for the OpenClaw engine, including the possibility that live toggle is unsupported and changes apply on the next wake
  - keep `RuntimeSurface` explicitly environment-scoped rather than turning it into an OpenClaw host-runtime abstraction

- `src/agent/providers/client-factory.ts`
  - keep Claude/OpenAI-specific client/env helpers scoped to those engines
  - do not overload this file into OpenClaw provider resolution if `src/agent/providers/engine.ts` owns engine dispatch

### 11.6 Session behavior in VisionClaw

Both VisionClaw modes may use the same selected engine family. This spec does not require separate engines per mode.

If mixed-mode engines are desired later, that is a separate feature and not part of this design.

### 11.7 Bootstrap and fallback behavior

- OpenClaw runtime bootstrap must be lazy and engine-gated.
- Claude/OpenAI startup must remain functional when the SDK directory is missing, unbuilt, or disabled, as long as the selected engine is not `openclaw-agent-sdk`.
- If `openclaw-agent-sdk` is selected and bootstrap fails, VisionClaw must surface a hard error naming the failed step: SDK load, runtime init, plugin init, auth/model resolution, or session bootstrap.
- Automatic fallback to a different engine is forbidden in phase 1.
- The OpenClaw SDK factory may keep exactly one initialized internal kernel per process/profile. If a second initialization attempt requests a different `stateDir`, `workspaceDir`, `agentDir`, plugin mode, or plugin allowlist, the factory must reject it rather than mutating global runtime state in place.

## 12. Submodule Strategy

### 12.1 Chosen strategy

VisionClaw will consume this repository as a dedicated submodule.

Proposed path in VisionClaw:

```text
packages/openclaw-agent-sdk
```

### 12.2 Why this path

- matches VisionClaw's existing `pnpm-workspace.yaml` package discovery without adding a second workspace root
- fits VisionClaw's current package/publish layout more cleanly than a new `vendor/*` tree
- still keeps the SDK distinct from the existing lightweight `packages/openclaw-sdk-shim`

### 12.3 Host-side packaging rule

VisionClaw must treat the submodule as a buildable library dependency, not as a source tree to cherry-pick from ad hoc.

No raw runtime imports from:

- `/Users/apple/programme/funny_projects/openclaw`
- `packages/openclaw-agent-sdk/src/upstream/**`

Only imports from the SDK's public built surface are allowed in host code.

### 12.4 Coexistence with the existing shim

- `packages/openclaw-sdk-shim` remains in place in phase 1 to satisfy current `openclaw/plugin-sdk` consumers such as `@tencent-weixin/openclaw-weixin`.
- The new SDK does not take over the host package name `openclaw`.
- If the SDK's embedded plugin-compat surface later becomes strong enough to replace or forward the shim, that is a separate migration and not part of this phase-1 design.

### 12.5 Published-package distribution rule

VisionClaw's published/installable artifact must contain the OpenClaw Agent SDK in a way that does not depend on git submodules or pnpm workspace layout at end-user install time.

Required properties:

- development/source integration may use the git submodule at `packages/openclaw-agent-sdk`
- runtime distribution must include the built SDK as either:
  - a bundled dependency, or
  - an equivalently vendored compiled artifact
- relying on `packages/openclaw-agent-sdk` existing in a consumer checkout after `npm install visionclaw` is forbidden
- VisionClaw release automation must verify the packaged artifact on a fresh install, not just the workspace checkout

Because the current VisionClaw publish manifest explicitly includes `packages/openclaw-sdk-shim/**/*` but not the new SDK path, the implementation must deliberately update publish-time inclusion and any postinstall/bundle wiring. Assuming the submodule will be published automatically is forbidden.

### 12.6 Enterprise repository ownership

- The canonical OpenClaw Agent SDK repository must live under the BabelCloud GitHub organization as `babelcloud/openclaw-agent-sdk`.
- Phase 0 is not complete until the local repository at `/Users/apple/programme/funny_projects/openclaw_agent_sdk` has a real `origin` remote pointing at that enterprise repository and the bootstrap history has been pushed.
- VisionClaw must consume the SDK submodule from the BabelCloud remote, not from a local path, personal fork, or ad hoc mirror.
- VisionClaw `main` must never reference an SDK commit that is unreachable from the BabelCloud remote.

### 12.7 Submodule traceability rule

- Every committed VisionClaw submodule pointer bump must reference an SDK commit SHA that has already been pushed.
- Local detached SDK HEADs or unpublished SHAs are forbidden as submodule targets.
- Every VisionClaw PR or commit that bumps `packages/openclaw-agent-sdk` must record the referenced SDK SHA in its body or metadata so the two-repo state is reconstructable later.

## 13. Development Path

### Phase 0: SDK repository bootstrap

Deliverables:

- independent git repository init inside `/Users/apple/programme/funny_projects/openclaw_agent_sdk`
- enterprise GitHub repository provisioning under `babelcloud/openclaw-agent-sdk`
- `origin` remote wiring to the BabelCloud repository
- package metadata
- TypeScript config
- public API skeleton
- test harness
- upstream snapshot manifest
- sync script scaffold with manifest validation

Exit criteria:

- `git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk rev-parse --show-toplevel` resolves to `/Users/apple/programme/funny_projects/openclaw_agent_sdk`
- `git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk remote get-url origin` resolves to the BabelCloud enterprise repository
- the bootstrap commit history has been pushed to the enterprise remote
- `pnpm test` runs
- public API files compile
- package name is `openclaw-agent-sdk`
- no dependency on VisionClaw yet

### Phase 1: extract embedded runner kernel

Extract/adapt from OpenClaw:

- embedded runner
- attempt path
- stream subscription
- tool adaptation
- context-engine bootstrap/finalize lifecycle
- embedded core-tool deny profile for host-owned tools
- model/auth/failover support

Do not include:

- gateway boot
- channels
- server startup

Exit criteria:

- local standalone embedded run works with a controlled prompt
- stream events are emitted deterministically
- one hosted-tool request/result-resume round-trip works end-to-end
- `tool_call` / `tool_result` / `tool_error` call ids remain stable end-to-end
- context-engine bootstrap and after-turn finalize hooks execute
- stop and compaction APIs function

### Phase 2: persistence and logging adapters

Add:

- host session persistence interface
- host transcript path resolver
- host logger sink
- provider-local raw artifact writer

Exit criteria:

- no writes to `~/.openclaw` in embedded test mode
- canonical session id can be injected and reused across turns
- transcript path is host-controlled

### Phase 3: tool and plugin preservation

Add:

- embedded plugin initialization
- allowlisted plugin mode
- host tool injection
- embedded-mode restrictions for gateway/channel tools

Exit criteria:

- allowlisted plugins can register tools/hooks
- host-injected VisionClaw tools are callable
- forbidden gateway/channel lifecycle tools are blocked by policy

### Phase 4: VisionClaw engine integration

Add:

- `engine` config
- OpenClaw provider backend in VisionClaw
- event normalization bridge
- state/log/transcript path mapping

Exit criteria:

- VisionClaw can run with `openclaw-agent-sdk`
- canonical session ids remain stable
- host log plus provider raw artifacts are both correct

### Phase 5: hardening and packaging

Add:

- submodule integration
- packaged-distribution wiring for the built SDK
- Node version and install checks
- build and smoke tests
- plugin compatibility tests
- documentation and operational notes

Exit criteria:

- submodule-based build is reproducible
- fresh-install packaged VisionClaw artifact contains a usable OpenClaw SDK runtime
- VisionClaw host and GUI packaging are not broken

## 14. Development Process

### 14.1 Extraction discipline

Every imported upstream OpenClaw module must be classified as one of:

- reused with no semantic change
- reused with import/path adaptation only
- wrapped
- forked and behaviorally changed

Maintain a machine-readable provenance manifest for each extracted file.

Only the extracted subset required by the SDK may live under `src/upstream/openclaw/*`. A full mirrored upstream tree is explicitly out of scope.

### 14.2 Change sequencing

Required order:

1. bootstrap SDK repo
2. extract kernel
3. inject persistence/logging seams
4. restore tools/plugins
5. integrate into VisionClaw
6. harden packaging/tests

Do not start VisionClaw integration before the SDK can run standalone under tests.

### 14.3 Review gates

After each phase:

- run SDK unit/contract tests
- run standalone embedded smoke
- review path ownership
- verify no forbidden writes outside host state dir
- verify non-selected Claude/OpenAI engine paths still avoid OpenClaw bootstrap/import side effects
- verify any referenced SDK SHA is reachable on the BabelCloud remote before updating the VisionClaw submodule pointer

### 14.4 Runtime compatibility discipline

- Node baseline for SDK and host integration: `>=22.14.0`
- VisionClaw host target remains Node `24.12.0`
- all public APIs must be tested under the host Node version

### 14.5 Repository governance

- The SDK canonical repository is `babelcloud/openclaw-agent-sdk`.
- The host canonical repository is `babelcloud/visionclaw`.
- Protected branches must reject force-push and preserve review history.
- Shared branches must be updated through normal commits or PR merges; history rewrite is forbidden once a commit is referenced by the other repository.

### 14.6 Commit traceability rules

Every logical change must be committed in the repository that owns the files before any downstream submodule bump is made.

Required commit metadata:

- SDK repo commits that change behavior or provenance must include:
  - `Spec: docs/superpowers/specs/2026-03-27-openclaw-agent-sdk-design.md`
  - `Phase: <phase-id>`
  - `Upstream-OpenClaw-SHA: <sha-or-none>`
  - `Provenance-Manifest: manifests/upstream-provenance.json` when extracted files changed
- VisionClaw commits that integrate or bump the SDK must include:
  - `Spec: docs/superpowers/specs/2026-03-27-openclaw-agent-sdk-design.md`
  - `Phase: <phase-id>`
  - `OpenClaw-Agent-SDK-SHA: <sdk-commit-sha>`

The exact footer format may be automated later, but the information itself is mandatory because the integration spans two repositories and an extracted upstream source.

### 14.7 Commit and push sequence

Cross-repository changes must follow this exact order:

1. Commit the SDK repository changes locally.
2. Run SDK verification in the SDK repository.
3. Push the SDK branch to the BabelCloud remote.
4. Verify the target SDK SHA is reachable on the remote.
5. Update VisionClaw's submodule pointer and any host integration changes against that pushed SDK SHA.
6. Commit the VisionClaw repository changes, including the referenced SDK SHA in commit metadata.
7. Run VisionClaw verification, including host tests and packaged-artifact checks as applicable.
8. Push the VisionClaw branch.
9. Merge or land the SDK change before landing the VisionClaw change that depends on it.

First-time bootstrap commands:

```bash
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk init
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk branch -M main
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk remote add origin https://github.com/babelcloud/openclaw-agent-sdk.git
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk add .
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk commit -m "chore: bootstrap openclaw-agent-sdk repository"
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk push -u origin main
git -C /Users/apple/programme/funny_projects/visionclaw_repo submodule add https://github.com/babelcloud/openclaw-agent-sdk.git packages/openclaw-agent-sdk
git -C /Users/apple/programme/funny_projects/visionclaw_repo add .gitmodules packages/openclaw-agent-sdk
git -C /Users/apple/programme/funny_projects/visionclaw_repo commit -m "chore: add openclaw-agent-sdk submodule"
git -C /Users/apple/programme/funny_projects/visionclaw_repo push -u origin <visionclaw-branch>
```

Normal SDK bump flow:

```bash
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk add .
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk commit -m "<sdk-change>"
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk push -u origin <sdk-branch>
git ls-remote https://github.com/babelcloud/openclaw-agent-sdk.git <sdk-sha>
git -C /Users/apple/programme/funny_projects/visionclaw_repo/packages/openclaw-agent-sdk fetch origin
git -C /Users/apple/programme/funny_projects/visionclaw_repo/packages/openclaw-agent-sdk checkout <sdk-sha>
git -C /Users/apple/programme/funny_projects/visionclaw_repo add packages/openclaw-agent-sdk
git -C /Users/apple/programme/funny_projects/visionclaw_repo commit -m "<visionclaw-change>"
git -C /Users/apple/programme/funny_projects/visionclaw_repo push -u origin <visionclaw-branch>
```

If branch protection requires PRs, the same sequencing still applies; only the transport changes from direct branch landing to PR merge.

### 14.8 Rollback discipline

Rollback must be possible without guessing hidden state.

Required rules:

- Use `git revert` on shared branches; do not rely on force-push or history rewrite for rollback.
- Every release candidate or merged milestone must have a reconstructable tuple:
  - VisionClaw commit SHA
  - OpenClaw Agent SDK commit SHA
  - upstream OpenClaw provenance SHA when relevant
- If the defect is SDK-only:
  - revert or replace the bad SDK commit in the SDK repository
  - push the revert
  - move VisionClaw's submodule pointer to the reverted or last-known-good SDK SHA in a separate VisionClaw commit
- If the defect is in VisionClaw integration:
  - revert the VisionClaw host commit(s)
  - if necessary, also pin the submodule back to the previous good SDK SHA

Reference rollback commands:

```bash
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk revert <bad-sdk-commit>
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk push origin <sdk-branch-or-main>
git -C /Users/apple/programme/funny_projects/visionclaw_repo/packages/openclaw-agent-sdk fetch origin
git -C /Users/apple/programme/funny_projects/visionclaw_repo/packages/openclaw-agent-sdk checkout <good-sha>
git -C /Users/apple/programme/funny_projects/visionclaw_repo add packages/openclaw-agent-sdk
git -C /Users/apple/programme/funny_projects/visionclaw_repo commit -m "revert: pin openclaw-agent-sdk to <good-sha>"
git -C /Users/apple/programme/funny_projects/visionclaw_repo push origin <visionclaw-branch-or-main>
```

## 15. Test Strategy

### 15.1 SDK unit tests

Focus:

- event normalization
- tool-call identity preservation
- hosted-tool suspend/resume semantics
- hosted-tool request / resume protocol
- session identity mapping
- transcript path resolution
- logger sink behavior
- canonical `system_prompt` host-log emission once per top-level query and no duplicate prompt log on hosted-tool resume
- tool injection and policy enforcement
- plugin mode restrictions
- compaction and stop semantics

### 15.2 SDK contract tests

Focus:

- public API shape
- exported subpaths
- backward-compatible types
- plugin-sdk compatibility exports
- execution-event schema stability, especially `tool_call` and `hosted_tool_call`

These tests are mandatory because this repository becomes a reusable SDK rather than an app.

### 15.3 SDK integration tests

Focus:

- single-turn run
- multi-turn same-session reuse
- injected interrupt behavior
- stop during stream
- forced compaction path
- host-log parity for `system_prompt` / `tool_call` / `tool_result` against existing Claude/OpenAI providers
- provider raw-stream capture of upstream `stopReason` / `pendingToolCalls` / `systemPromptReport` without replacing canonical host log entries
- hosted-tool request / result-resume round-trip
- tool-call ordering and `callId` continuity through result/error events
- allowlisted plugin tool execution

### 15.4 Filesystem safety tests

Mandatory assertions:

- no writes under `~/.openclaw`
- no independent `sessions.json`
- transcripts rooted under host-provided profile path
- raw stream artifacts root under host-provided profile path
- models/auth/profile data rooted under host-provided embedded `agentDir`

### 15.5 VisionClaw host tests

Add or update host-side tests for:

- engine selection and config validation
- `SessionManager` engine dispatch
- OpenClaw provider event normalization
- session id persistence continuity
- `manage_mcp_servers` persisted add/remove/list behavior under the OpenClaw engine
- logger mapping
- interrupt handling behavior when the SDK can or cannot accept live injections
- accepted live injections are either delivered or reported in a way that allows requeue; no silent orphaning
- non-selected engine startup proving OpenClaw runtime is not imported/initialized
- selected-engine bootstrap failure surfacing a hard error without silent fallback

### 15.6 VisionClaw smoke tests

Run at least:

- `claude-agent-sdk` baseline regression
- `openai-agent-sdk` baseline regression
- `openclaw-agent-sdk` standalone smoke inside VisionClaw host

The new engine must not regress the existing two.

### 15.7 Plugin compatibility tests

Use a small allowlisted fixture plugin set to prove:

- plugin load
- hook invocation
- tool registration
- policy application

Do not rely on broad upstream plugin suites initially.

### 15.8 Packaging tests

For VisionClaw:

- submodule checkout bootstrap
- fresh clone with `--recurse-submodules`
- host TypeScript build
- host test run
- submodule SHA reachability check against the BabelCloud remote
- `npm pack` or equivalent packaged-artifact smoke install proving the built SDK is present at runtime
- GUI dependency sanity if any part of the `openclaw` compatibility package remains shared with GUI

## 16. Risks And Mitigations

### Risk 1: OpenClaw global runtime state leaks across sessions

Mitigation:

- SDK factory / internal kernel singleton per host process
- explicit plugin init/shutdown
- session state isolated by canonical `sessionKey` and transcript path

### Risk 2: hidden writes to default OpenClaw state paths

Mitigation:

- mandatory path adapter seam
- no ambient import-time path constants sourced from global `OPENCLAW_STATE_DIR` / `OPENCLAW_AGENT_DIR`
- filesystem tests that fail on writes outside allowed roots

### Risk 3: OpenClaw tools bypass VisionClaw host responsibilities

Mitigation:

- embedded-mode tool policy profile
- explicit deny list for gateway/channel/message lifecycle tools

### Risk 4: engine/config refactor breaks existing Claude/OpenAI flows

Mitigation:

- introduce `engine` with migration defaults
- keep current provider-specific code paths intact behind an engine dispatcher
- run full regression suite for existing engines

### Risk 5: plugin compatibility surface becomes too large to stabilize

Mitigation:

- stable public API allowlist
- contract tests for exported subpaths
- do not expose the entire upstream package root

### Risk 6: published VisionClaw artifact omits the SDK or references workspace-only paths

Mitigation:

- explicit packaged-distribution rule
- fresh-install packaged-artifact smoke test
- forbid runtime dependence on git submodule presence

### Risk 7: OpenClaw bootstrap side effects leak into Claude/OpenAI paths

Mitigation:

- engine-gated dynamic loader
- no top-level OpenClaw imports in shared startup paths
- regression tests proving non-selected engines do not initialize OpenClaw runtime

### Risk 8: OpenClaw integration grows into a second host runtime abstraction

Mitigation:

- session-first public SDK API
- keep bootstrap/private kernel state behind the SDK factory only
- keep VisionClaw `RuntimeSurface` environment-scoped

### Risk 9: tool-call semantics are lost during normalization

Mitigation:

- first-class `tool_call` / `tool_result` / `tool_error` / `hosted_tool_call` event contract
- stable `callId` propagation tests
- hosted-tool resume keyed by explicit `callId`

### Risk 10: two-repository drift breaks auditability or rollback

Mitigation:

- enterprise remote ownership under BabelCloud
- push SDK first, then VisionClaw submodule pointer
- forbid local-only submodule SHAs
- use revert-based rollback on shared branches

## 17. Acceptance Criteria

This project is complete when all of the following are true:

- `openclaw_agent_sdk` is a standalone buildable/testable SDK repository with its own git root and npm package name `openclaw-agent-sdk`.
- the SDK canonical remote exists under `babelcloud/openclaw-agent-sdk` and the local repository is pushed there.
- VisionClaw can select `openclaw-agent-sdk` as a third engine family.
- VisionClaw consumes it via submodule at `packages/openclaw-agent-sdk` without removing `packages/openclaw-sdk-shim`.
- the host-facing SDK contract remains session-first; VisionClaw does not gain a second top-level agent runtime platform abstraction.
- OpenClaw Agent SDK can run a multi-turn session inside VisionClaw using the canonical VisionClaw session id.
- No separate authoritative session registry is created by the SDK.
- OpenClaw-specific transcripts/raw-event artifacts are written under the active VisionClaw profile.
- OpenClaw tools/plugin runtime are preserved in embedded mode subject to explicit policy.
- tool-call semantics are preserved end-to-end, including stable `callId` continuity and explicit hosted-tool suspend/resume.
- Claude/OpenAI paths can still start and run without importing or initializing OpenClaw runtime when that engine is not selected.
- every committed VisionClaw SDK bump points to an SDK SHA reachable from the BabelCloud remote and is revertable without force-push.
- A fresh packaged VisionClaw install contains the SDK runtime and can boot the OpenClaw engine without workspace-only paths.
- Existing Claude and OpenAI SDK paths still pass their regression checks.

## 18. Immediate Next Deliverable After Spec Approval

After this spec is approved, the next artifact is a detailed implementation plan that decomposes the work into concrete phases, file-level tasks, and verification commands for:

1. SDK repo bootstrap
2. kernel extraction
3. persistence/logging adaptation
4. plugin/tool preservation
5. VisionClaw integration
6. test and packaging hardening
