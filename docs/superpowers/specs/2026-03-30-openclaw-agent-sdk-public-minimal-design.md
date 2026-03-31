# OpenClaw Agent SDK Public Minimal Design Spec

Date: 2026-03-30
Location: `/Users/apple/programme/funny_projects/openclaw_agent_sdk`
Status: Proposed
Audience: SDK maintainers and implementation engineers

## 1. Goal

Build a public, standalone, minimal `openclaw-agent-sdk` that any Node.js developer can use
without adopting VisionClaw, OpenClaw gateway, channel runtimes, or the OpenClaw plugin system.

This public v1 is intentionally smaller than both:

- the original VisionClaw-oriented SDK design in
  `docs/superpowers/specs/2026-03-27-openclaw-agent-sdk-design.md`
- the full OpenClaw embedded runtime centered on `runEmbeddedPiAgent()`

The product we are building in this spec is:

- a session-first embedded SDK
- for in-process use from Node.js applications
- with a minimal built-in tool set
- with explicit hosted-tool suspend/resume
- with file-backed persistence and logging defaults
- with no plugin system
- with no channel system
- with no gateway runtime

## 2. Why This Spec Exists

The current repository has a strong internal shape but does not yet define a clean public product.

Today the codebase mixes three different intents:

- a VisionClaw compatibility target
- an OpenClaw upstream extraction target
- a possible public SDK target

Those goals overlap, but they are not the same product.

The current design spec is still host-first and VisionClaw-first. It locks in requirements such as:

- many-provider support through OpenClaw's full provider/auth stack
- plugin loading and hook execution
- VisionClaw-owned canonical session state
- a compatibility-focused boundary rather than a public developer experience

That scope is too large for a stable public v1.

This spec narrows the product to the minimum public shape that is worth shipping.

## 3. Product Decision

Public v1 will remain branded and shipped as `openclaw-agent-sdk`.

This spec does **not** introduce a second public package name. The repository path, package name,
and public symbols must converge on `OpenClaw*` naming. Any partial `GeneralAgent*` rename work in
the current tree is treated as drift and must be cleaned up as part of this effort.

Public v1 is defined by these decisions:

- Runtime: Node.js `>=22.14.0`
- Module format: ESM only
- Provider support in v1: Anthropic only
- Public audience: backend services, CLIs, desktop apps, and local developer tools embedding an agent
- Persistence: default file-backed persistence included
- Logging: default console logger included
- Built-in tools in v1: `read`, `write`, `edit`, `exec`, `process`
- Hosted tools: supported and first-class
- Images: supported for user input when the selected Anthropic model supports images
- VisionClaw compatibility: optional subpath, not part of the core public API story

## 4. Non-Goals

The following are explicitly out of scope for public v1:

- OpenClaw gateway
- channel runtimes
- message routing
- owner notifications
- cron
- node host control plane
- plugin loading
- plugin hooks
- `plugin-sdk` as a public compatibility promise
- multi-provider support
- auth profile rotation
- provider failover
- runtime plugin registration
- channel-specific tools such as `message`, `gateway`, `nodes`
- session-management tools such as `sessions_*`
- browser automation in the default SDK surface
- subagents
- channel-aware prompt shaping
- VisionClaw-specific canonical session ownership
- silent stub fallback behavior when credentials are missing

Public v1 is not required to reach full feature parity with full OpenClaw embedded mode.

## 5. Source Facts This Spec Relies On

### 5.1 Official OpenClaw embedding boundary

The official embeddable seam in OpenClaw is the embedded runner path centered on
`runEmbeddedPiAgent()` and the underlying `createAgentSession()` / `SessionManager` flow, not the
gateway stack.

Within the upstream runtime, that path currently mixes together:

- session manager lifecycle
- context-engine setup and compaction
- provider/model resolution
- auth profile resolution
- runtime plugin loading
- client-hosted tool handling through `pendingToolCalls`
- many channel and messaging concerns

This is the right architectural seam, but the public SDK must expose only a strict subset of that
behavior.

### 5.2 Current repository strengths

The current repository already has useful public-SDK building blocks:

- a session-first public API under `src/public/*`
- structured stream events
- hosted-tool definitions and result submission APIs
- transcript persistence
- host logging hooks
- a VisionClaw compatibility adapter
- a vendored agent loop and Anthropic streaming provider
- a minimal local tool implementation set

### 5.3 Current repository gaps

The current repository also has several product-level gaps that block a public release:

- hosted-tool resume in the real loop path is not a full same-turn continuation yet
- the current public API still exposes plugin-related concepts
- the current runtime path is effectively Anthropic-only but the docs imply a larger provider story
- missing credentials can fall back to a stub path instead of failing fast
- public ergonomics are too host-framework oriented because callers must always supply their own
  `sessionStore` and `logger`
- the package name, README title, and exported type names are currently inconsistent

## 6. Public v1 Capability Contract

Public v1 must provide the following guarantees.

### 6.1 SDK lifecycle

- The caller can bootstrap the SDK once.
- The caller can create and reuse sessions explicitly.
- The caller can shut the SDK down cleanly.

### 6.2 Session lifecycle

- A session has a stable host-visible identity.
- A session can stream a user turn.
- A session can stop an in-flight turn.
- A session can expose usage snapshots.
- A session can request compaction.
- A session can be resumed from persisted state after process restart.

### 6.3 Event model

The public event contract must preserve execution-layer semantics rather than flattening everything
into text.

At minimum, the event model must support:

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

### 6.4 Hosted-tool protocol

Hosted tools are a core public feature.

The SDK must:

- emit a hosted-tool event with a stable `callId`
- suspend the current turn at that boundary
- persist enough state to resume the same session after the tool result is supplied
- resume the same turn when the host supplies `submitHostedToolResult()` or `submitHostedToolError()`
- emit `turn_complete` only after the resumed turn actually completes

This is stricter than the current synthetic resume shortcut.

### 6.5 Built-in tools

Public v1 includes only these built-in tools:

- `read`
- `write`
- `edit`
- `exec`
- `process`

The default public surface does not include:

- `browser`
- `message`
- `gateway`
- `cron`
- `nodes`
- `sessions_*`

`web_fetch` and `web_search` are deferred to a later release. They are not required for public v1.

### 6.6 Anthropic-only provider scope

Public v1 supports Anthropic only.

That means:

- the public options surface uses an explicit Anthropic provider configuration
- there is no public `authProfileId`
- there is no public multi-provider failover promise
- there is no public plugin-driven provider override path
- missing Anthropic credentials are a hard error

## 7. Public API Shape

Public v1 keeps the session-first architecture but simplifies and hardens the contract.

### 7.1 Naming cleanup

The public surface must standardize on these names:

- `createOpenClawAgentSdk`
- `OpenClawAgentSdk`
- `OpenClawAgentSdkOptions`
- `OpenClawAgentSession`
- `OpenClawSessionParams`
- `OpenClawTurnInput`
- `OpenClawStreamEvent`

The current accidental `GeneralAgentAgentSdk` style naming must be removed.

### 7.2 SDK options

Public v1 options should look conceptually like this:

```ts
export interface OpenClawAgentSdkOptions {
  workspaceDir: string;
  dataDir?: string;
  logger?: OpenClawHostLogger;
  sessionStore?: OpenClawSessionStoreAdapter;
  provider: {
    anthropicApiKey: string;
    baseUrl?: string;
  };
  builtInTools?: Array<"read" | "write" | "edit" | "exec" | "process">;
  hostedTools?: OpenClawHostedToolDefinition[];
  execPolicy?: {
    allowed: boolean;
    cwd?: string;
  };
}
```

Public v1 must remove these concepts from the top-level public options surface:

- `pluginMode`
- `enabledPluginIds`
- generic `env` bags
- host-facing `profileId`
- host-facing `agentDir`

If the internal runtime still needs internal storage directories, the SDK must derive them from
`dataDir` rather than forcing public callers to understand OpenClaw's historical directory layout.

### 7.3 Session params

Public v1 session creation should look conceptually like this:

```ts
export interface OpenClawSessionParams {
  sessionId: string;
  sessionKey?: string;
  mode?: "general" | "coding";
  systemPrompt: string;
  model: string;
  transcriptPath?: string;
  rawEventLogPath?: string;
}
```

Public v1 must remove these concepts from public session params:

- `authProfileId`
- free-form `modelRef` with hidden provider semantics

The SDK may still map the public `model` string into internal provider-specific runtime state.

### 7.4 Defaults

Public v1 must ship default implementations for:

- `createFileSessionStore(...)`
- `createConsoleLogger(...)`

Custom adapters remain supported, but they are optional rather than mandatory.

## 8. Target Architecture

### 8.1 Layer split

Public v1 has four internal layers.

1. `src/public/*`
   - stable supported API surface

2. `src/core/public-runtime/*`
   - SDK-owned runtime orchestration for public use
   - session lifecycle
   - persistence defaults
   - tool policy
   - provider bootstrap

3. `src/upstream/openclaw/*`
   - vendored upstream implementation fragments
   - never directly exported as public API

4. `src/compat/visionclaw/*`
   - optional compatibility adapter
   - explicitly not part of the public-core design

### 8.2 Official-source alignment

The public runtime must move closer to the official embedded seam rather than continuing to grow as
a custom alternative runtime.

The intended direction is:

- reuse official embedded-session/session-manager behavior where it materially affects persistence,
  continuity, or compaction correctness
- keep using vendored upstream code under `src/upstream/openclaw/*`
- strip channel, plugin, and gateway concerns out of the public runtime adapter
- keep all upstream-specific complexity private behind the SDK surface

Public v1 does **not** need to expose `runEmbeddedPiAgent()` directly. It does need to align its
behavior with the same underlying execution semantics wherever those semantics matter to public users.

### 8.3 Hosted-tool continuation design

Hosted-tool suspend/resume is the highest-priority runtime fix.

The target behavior is:

1. User turn starts.
2. Model decides to call a hosted tool.
3. SDK emits `tool_call`.
4. SDK emits `hosted_tool_call`.
5. Session is marked as suspended with persisted pending-call state.
6. Host executes the tool externally.
7. Host submits the result with the same `callId`.
8. SDK injects the tool result back into the same underlying session/attempt context.
9. Model continues and may emit more assistant text, more tool calls, or another hosted tool call.
10. SDK emits `turn_complete` only when that resumed execution actually ends.

The current `createHostedToolResumeEvents()` synthetic shortcut is not sufficient for public v1 and
must be replaced in the real runtime path.

### 8.4 Persistence model

Public v1 persistence has two layers:

- transcript/session state owned by the underlying agent session runtime
- lightweight SDK metadata owned by the public session store

The default file-backed session store must persist:

- `sessionId`
- `sessionKey`
- transcript path
- latest usage snapshot
- selected model
- last-updated timestamp
- pending hosted-tool call metadata when suspended

The transcript file remains the source of truth for message/tool history. The metadata store exists
to let the public SDK find and rehydrate sessions without introducing a second full transcript format.

### 8.5 Tool policy

Public v1 tool policy must be explicit and stable.

Required rules:

- file tools are rooted to `workspaceDir`
- `exec` is disabled unless explicitly enabled
- `process` visibility is limited to processes started through SDK-owned execution helpers
- no hidden tool families are exposed by default
- hosted tools are opt-in and must be declared

### 8.6 Compaction and context

Public v1 keeps compaction but narrows the promise.

Required:

- expose usage snapshots
- expose a manual `requestCompaction()` path
- preserve transcript continuity across compaction

Deferred:

- broad public claims about auto-overflow compaction parity with full OpenClaw
- public context-engine plugin discovery
- public plugin-owned compaction hooks

If upstream compaction helpers are reused internally, they must run in a fixed SDK-owned mode with
no external plugin dependency.

## 9. Required Repository Changes

This section is normative. These are the concrete codebase changes required to reach the target.

### 9.1 Public API cleanup

Files to modify:

- `src/index.ts`
- `src/public/sdk.ts`
- `src/public/session.ts`
- `src/public/types.ts`
- `src/public/events.ts`
- `src/public/persistence.ts`
- `README.md`

Required changes:

- standardize all public symbol names on `OpenClaw*`
- remove `pluginMode` and `enabledPluginIds` from the public surface
- remove `authProfileId` from public session params
- replace ambiguous `modelRef` with explicit public model configuration
- make Anthropic provider configuration explicit and mandatory
- update README examples so they no longer show `openai/gpt-5.4` as a public example

### 9.2 Default public adapters

Files to add:

- `src/public/defaults.ts`
- `src/core/sessions/file-session-store.ts`
- `src/core/logging/console-logger.ts`

Required changes:

- add a default file-backed session store
- add a default console logger
- export both from the public surface

### 9.3 Real runtime alignment

Files to modify:

- `src/core/embedded-runner/sdk-factory.ts`
- `src/core/embedded-runner/sdk-session.ts`
- `src/core/embedded-runner/hosted-tool-bridge.ts`
- `src/upstream/openclaw/agents/pi-embedded-runner/session-manager-init.ts`
- vendored upstream runtime helpers needed for correct session lifecycle

Files likely to add:

- `src/core/public-runtime/session-driver.ts`
- `src/core/public-runtime/runtime-options.ts`
- `src/core/public-runtime/provider-bootstrap.ts`

Required changes:

- remove stub fallback behavior when Anthropic credentials are missing
- align session execution with official embedded-session behavior where persistence and continuation
  correctness depend on it
- preserve current session-first public shape while replacing the runtime internals

### 9.4 Hosted-tool suspend/resume fix

Files to modify:

- `src/core/embedded-runner/sdk-session.ts`
- `src/core/normalization/upstream-events.ts`
- `src/public/session.ts`
- `tests/integration/standalone-session.test.ts`
- `tests/integration/visionclaw-compat-session.test.ts`

Required changes:

- replace synthetic resume completion with real same-turn continuation
- persist pending hosted call state
- support process restart before tool result submission
- ensure the resumed turn can emit assistant text after the tool result
- keep `callId` stable through the full suspend/resume lifecycle

### 9.5 Tool surface reduction

Files to modify:

- `src/tools/tool-assembly.ts`
- `src/core/tools/tool-policy.ts`
- any related tool registration tests

Required changes:

- make the public default tool set exactly `read`, `write`, `edit`, `exec`, `process`
- remove browser and web tools from the default public assembly
- keep denied OpenClaw gateway/channel tool families out of the public runtime

### 9.6 Anthropic-only runtime hardening

Files to modify:

- `src/core/embedded-runner/model-from-ref.ts`
- `src/providers/anthropic.ts`
- any provider-facing public types

Required changes:

- make Anthropic the only supported public provider in v1
- make missing `anthropicApiKey` a hard configuration error
- keep `ANTHROPIC_BASE_URL` override support for advanced users
- remove public documentation that implies broad provider support in v1

### 9.7 VisionClaw compatibility isolation

Files to modify:

- `src/compat/visionclaw/*`
- `package.json`
- `README.md`

Required changes:

- keep `compat/visionclaw` as an optional subpath
- do not let the default entrypoint depend on VisionClaw compatibility modules
- document VisionClaw compatibility separately from the public Quick Start

### 9.8 Packaging and release hardening

Files to add:

- `LICENSE`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `examples/minimal-session.ts`
- `examples/hosted-tool.ts`
- `examples/resume-session.ts`

Files to modify:

- `.github/workflows/sdk-ci.yml`
- `scripts/package-smoke.mjs`
- `package.json`

Required changes:

- add legal and contribution metadata required for a public package
- add real public examples that do not depend on VisionClaw
- extend CI to cover at least Node 22 and Node 24
- keep dist-only packaging
- add an environment-gated live Anthropic smoke test

## 10. Testing Requirements

Public v1 is not complete unless the following test categories exist.

### 10.1 Contract tests

- public types export correctly
- default adapters export correctly
- unsupported public options are not present

### 10.2 Integration tests

- create a session and stream a normal assistant turn
- call a built-in file tool and observe structured events
- call a hosted tool and resume the same turn
- stop an in-flight turn
- persist and rehydrate session metadata
- restart the process and resume a suspended hosted-tool session

### 10.3 Packaged smoke tests

- install from tarball into a clean consumer app
- run a basic turn
- run a hosted-tool turn
- verify transcript and metadata files are written

### 10.4 Live provider smoke tests

These tests are env-gated and do not run on every PR by default.

Required scenarios:

- valid Anthropic API key, real model, normal turn
- image input accepted by a vision-capable model
- hosted-tool turn resumes correctly under a real model

## 11. Acceptance Criteria

Public v1 is complete when all of the following are true.

1. A new Node.js developer can install the package and run a basic session with only:
   - `workspaceDir`
   - optional `dataDir`
   - Anthropic API key
   - system prompt
   - model

2. The README Quick Start does not mention VisionClaw, plugins, channels, or multi-provider config.

3. Missing Anthropic credentials fail immediately with a clear configuration error.

4. A hosted-tool call can suspend and resume the same turn, and the resumed turn can emit assistant
   output before `turn_complete`.

5. The public package includes default file persistence and console logging so custom adapters are
   optional.

6. The default runtime does not load runtime plugins and does not expose channel/gateway tool families.

7. The package ships with a public license and release-grade CI.

## 12. Rollout Plan

Implementation should proceed in four phases.

### Phase 1: Public API and scope cleanup

- clean up names
- remove plugin/channel/provider over-promises from the public API
- rewrite README and examples around the public minimal story

### Phase 2: Runtime correctness

- align session runtime with the official embedded seam where needed
- implement real hosted-tool suspend/resume
- remove stub fallback behavior

### Phase 3: Default developer experience

- add default session store and logger
- finalize tool policy and default tool set
- ship usable examples

### Phase 4: Release hardening

- add legal and security metadata
- expand CI
- add env-gated live provider tests
- publish a first public prerelease

## 13. Summary

The key decision in this spec is deliberate reduction.

We are not trying to publish all of OpenClaw.
We are not trying to publish all of VisionClaw's integration surface.
We are not trying to publish a plugin host, a gateway, or a many-provider orchestration platform.

We are publishing a minimal, public, session-first SDK.

If a feature does not directly help a public developer embed a single agent session in a Node.js
process with stable tools, persistence, and hosted-tool continuation, it does not belong in public v1.
