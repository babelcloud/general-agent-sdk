# General Agent SDK Source-Sync Design Spec

Date: 2026-03-31
Location: `/Users/apple/programme/funny_projects/openclaw_agent_sdk`
Status: Draft for review
Audience: SDK maintainers and implementation engineers
Supersedes:
- `docs/superpowers/specs/2026-03-27-openclaw-agent-sdk-design.md`
- `docs/superpowers/specs/2026-03-30-openclaw-agent-sdk-public-minimal-design.md`

## 1. Goal

Build a standalone `general-agent-sdk` that:

- uses OpenClaw's real embedded SDK seam as the internal source of truth
- preserves SDK-suitable OpenClaw capabilities instead of re-inventing them locally
- reaches the same public capability tier as Claude Agent SDK for embedded agent use cases
- excludes OpenClaw features that are not SDK concerns, especially Cron, Channel, Gateway, and related control-plane responsibilities
- is fully decoupled from VisionClaw in branding, packaging, and public API

The target is not "an OpenClaw-flavored host adapter". The target is a general-purpose embedded agent SDK with source-synced internals.

## 2. Product Decision

The product is:

- package name: `general-agent-sdk`
- public brand: `General Agent SDK`
- public symbol family: `GeneralAgent*`

The product is not:

- `openclaw-agent-sdk`
- a VisionClaw compatibility package
- a published `plugin-sdk`
- a repackaged OpenClaw gateway

All published `VisionClaw` compatibility exports must be removed from this repository and package.

## 3. Parity Target

The acceptance bar is capability parity with Claude Agent SDK for embedded-agent scenarios, not API-shape cloning.

The SDK must support the same solution class for most embedded agent tasks that Claude Agent SDK supports:

- autonomous multi-step agent execution
- built-in file/code/shell/web tool usage
- custom in-process tools
- MCP tools
- approvals and user-input pauses
- resumable sessions
- hooks
- subagents
- streaming
- file checkpoints when file mutation tools are enabled

Matching exact Anthropic terminology is not required. Matching host-visible capability is required.

## 4. Hard Non-Goals

The following remain out of scope for the SDK:

- gateway runtime
- channel ingress and egress
- owner notifications
- cron scheduling and cron delivery
- node host control plane
- channel-specific action routing
- `message`, `gateway`, `cron`, `nodes`
- `sessions_list`, `sessions_history`, `sessions_send`
- any VisionClaw-specific session protocol or adapter export

These concerns may exist in upstream OpenClaw, but they are not SDK responsibilities here.

## 5. Source-of-Truth Rule

Implementation must follow this priority order:

1. OpenClaw source code for the embedded runner, tool assembly, tool policies, hooks, and related SDK-suitable behavior
2. `pi-coding-agent` and pi mono source where OpenClaw's embedded path depends on them
3. `openclaw_tool_map.txt` as a secondary checklist only
4. this repository's current simplified runtime only when it does not conflict with items 1-3

The repository must stop treating `src/upstream/openclaw/**/*` as archival reference only. The OpenClaw-derived embedded seam must become a live internal runtime dependency.

## 6. Architecture

### 6.1 Public Layer

The supported public API remains under `src/index.ts` and `src/public/*`.

The public surface must expose only general SDK concepts:

- SDK factory
- sessions
- stream events
- tool registration
- MCP integration
- hooks
- checkpointing
- persistence
- approvals / user-input continuation
- subagents

The public API must not expose:

- VisionClaw compatibility types
- OpenClaw-branded symbol names
- inert host-specific fields
- plugin-runtime leakage as a public compatibility promise

Plugin support is intentionally narrow. The SDK may keep a plugin seam for web capabilities such as web search providers and related web tooling, but it should not grow a broad general-purpose plugin platform for non-web SDK features.

### 6.2 Internal Runtime Layer

The internal runtime must be reorganized around the actual OpenClaw embedded seam:

- tool assembly
- tool policy pipeline
- pi tool adapters
- hook runner integration
- compaction
- session lifecycle
- hosted-tool continuation
- provider/model resolution relevant to SDK scope

The current handwritten local runtime in `src/core/*` and `src/loop/*` may remain temporarily during migration, but it is not the end-state source of truth.

### 6.3 Upstream Boundary

The repository may still vendor only a subset of OpenClaw, but that subset must be:

- sufficient to build the SDK runtime
- internally coherent
- compiled and tested
- provenance-tracked

Partial vendoring that cannot compile is not acceptable.

## 7. Naming and Packaging

### 7.1 Required Renames

The public surface must converge on names like:

- `createGeneralAgentSdk`
- `GeneralAgentSdk`
- `GeneralAgentSdkOptions`
- `GeneralAgentSession`
- `GeneralAgentSessionParams`
- `GeneralAgentStreamEvent`

Names like `GeneralAgentAgentSdk` and `GeneralAgentAgentSession` are bugs and must be removed.

### 7.2 Package Exports

The package must publish only general SDK exports from `.`.

It must remove:

- `./compat/visionclaw`
- `./plugin-sdk`

### 7.3 Documentation Cleanup

Repository-facing docs must stop presenting the SDK as:

- a VisionClaw integration project
- a public OpenClaw rebrand
- a minimal toy subset with intentionally reduced scope for web and hooks

Old docs may be archived as historical design records, but they must not remain the active source of truth.

## 8. Tool Model

Tools must be classified explicitly into four buckets.

### 8.1 Core Built-In Tools

These are required for public v1:

- `read`
- `write`
- `edit`
- `apply_patch`
- `exec`
- `process`
- `web_search`
- `web_fetch`

Behavior for these tools must be source-synced to OpenClaw, not implemented as simplified local substitutes.

### 8.2 Optional Built-In Tools

These are SDK-suitable and should be integrated when their upstream dependencies can be made coherent inside the SDK:

- `pdf`
- `image`
- `image_generate`
- `browser`
- `canvas`
- `tts`
- `memory_get`
- `memory_search`
- `agents_list`
- `session_status`
- `sessions_spawn`
- `sessions_yield`
- `subagents`

Optional built-ins are not required to ship all at once, but each must be explicitly tracked as:

- implemented
- pending
- blocked by missing upstream dependency
- intentionally deferred

### 8.3 Host-Bridged Tools

Some capabilities may be exposed through host-provided tools instead of SDK-native built-ins when that is the correct architecture. This is acceptable only when the public behavior remains equivalent.

This does not imply a broad plugin architecture. Outside the web capability area, new extensibility should prefer core built-ins, hosted tools, hooks, or MCP instead of additional plugin surfaces.

### 8.4 Out-of-Scope Tools

These remain excluded from the SDK:

- `message`
- `gateway`
- `cron`
- `nodes`
- `sessions_list`
- `sessions_history`
- `sessions_send`

## 9. Hook Model

The SDK must migrate OpenClaw's hook system into the SDK runtime instead of keeping only ad hoc `beforeToolCall` / `afterToolCall` callback slots.

### 9.1 SDK-Native Hook Events

These hook families belong in the SDK and must be implemented natively:

- `before_model_resolve`
- `before_prompt_build`
- `before_agent_start`
- `llm_input`
- `llm_output`
- `agent_end`
- `before_compaction`
- `after_compaction`
- `before_reset`
- `before_tool_call`
- `after_tool_call`
- `tool_result_persist`
- `before_message_write`
- `session_start`
- `session_end`
- `subagent_spawning`
- `subagent_delivery_target`
- `subagent_spawned`
- `subagent_ended`

### 9.2 Host-Bridged Hook Events

These may remain available through the same hook runner, but only when the host explicitly emits them:

- `inbound_claim`
- `message_received`
- `message_sending`
- `message_sent`
- `gateway_start`
- `gateway_stop`
- `before_dispatch`

This preserves hook portability without forcing channel/gateway responsibilities into the SDK.

### 9.3 Hook Semantics

The SDK must preserve upstream hook semantics where relevant:

- modifying hooks stay ordered and merge results predictably
- blocking hooks can stop tool execution
- observation hooks remain fire-and-forget when upstream does so
- synchronous hot-path hooks stay synchronous where upstream requires that behavior

In particular, `tool_result_persist` and `before_message_write` must preserve structured transcript mutation semantics.

## 10. Agent Loop Requirements

The SDK's loop must be robust enough to continue invoking tools until work is actually complete.

### 10.1 Required Loop Behavior

A single run must support:

- assistant -> tool -> assistant -> tool repeated as needed
- mixed local tools, hosted tools, MCP tools, and subagents
- deterministic terminal completion
- explicit stop and abort
- interruption for approvals and user input

### 10.2 Hosted Tool Continuation

Hosted tool handling must be a real same-run continuation.

It is not acceptable to:

- emit a synthetic `tool_result`
- emit `turn_complete`
- require the host to start a logically new run

The run must pause at the hosted-tool boundary and continue the same run when the result arrives.

### 10.3 Structured Tool Results

Tool results must preserve both:

- user-visible content
- structured details payloads

The current thin `content`-only model is insufficient for source-synced OpenClaw tools such as `web_fetch`, `pdf`, `sessions_*`, and other structured-result tools.

### 10.4 Conversation Continuity

The runtime must preserve message history correctly across turns in-process and across persisted resumes.

The SDK must not rely on a message flow that drops updated loop state after a completed turn.

### 10.5 Compaction

> **Status: ✅ Implemented (truncation-based v1).** `requestCompaction()` and `maybeCompactByTokens()` now perform truncation-based compaction: older messages are replaced with a concise summary while recent messages are preserved. The implementation fires `before_compaction`/`after_compaction` hooks, emits `compaction_started`/`compaction_finished` stream events, and updates usage snapshots. Context window size is dynamically resolved per model. Future enhancement: upgrade to LLM-based summarization when deeper conversation preservation is needed.

Compaction must be a working runtime capability, not a timestamp placeholder.

The SDK must:

- detect compaction triggers
- run compaction
- emit compaction lifecycle events
- invoke compaction hooks
- preserve session integrity across retries and resumes

## 11. Session Model

The public session layer must support:

- create
- continue latest
- resume by session id
- fork from existing session
- enumerate stored sessions
- read transcript / history for a stored session

Hosted-tool suspension and approval suspension must persist enough state to survive process restart.

## 12. Permissions, Approvals, and User Input

The SDK must support a real control plane for:

- allow/deny / allowlist / approval modes
- tool approval interrupts
- ask-user-question style pauses
- resume with user answer
- host-controlled policy decisions

This must not be approximated by tool stubbing or host-side text parsing.

## 13. MCP and Custom Tools

The SDK must support:

- in-process custom tools
- MCP tools from local processes
- MCP tools from HTTP endpoints

These must compose with the same loop, event, permission, and hook systems as built-in tools.

## 14. Subagents

Subagents are in scope for the SDK.

The SDK must support:

- programmatic subagent creation
- scoped instructions
- scoped tool access
- lifecycle events and hooks
- parent/child coordination without host-specific session protocols

Subagents are not the same as channel sessions or gateway task routing.

## 15. Checkpointing

If file mutation tools are enabled, the SDK must support checkpointing and rollback of agent-made file changes without requiring Git.

Checkpointing is part of the expected embedded-agent capability tier and must be designed as a first-class SDK feature rather than a future afterthought.

## 16. Credential and Failure Policy

Missing required credentials must be hard errors.

The SDK must not:

- silently fall back to stub completions
- pretend to finish a run without a real model/tool path
- silently downgrade to a different runtime behavior

Failure must be explicit and actionable.

## 17. Acceptance Criteria

The SDK is acceptable only when all of the following are true:

> **Implementation status audit — last updated 2026-03-31 (post-convergence)**
>
> ✅ = fully satisfied, ⚠️ = partially satisfied, ❌ = not started
>
> **15 of 15 fully satisfied. 0 partially satisfied. 0 not started.**

1. ✅ One SDK call can start a run that autonomously executes tool/model/tool/model turns until terminal completion, host interruption, or an explicit wait-for-input boundary.
2. ✅ `web_search` and `web_fetch` ship as built-in SDK capabilities and their behavior is synchronized to OpenClaw source semantics rather than the current simplified local implementations.
3. ✅ Every SDK-suitable OpenClaw tool is explicitly classified as `core built-in`, `optional built-in`, `host-bridged`, or `out-of-scope`. — *Tool catalog with runtime classification table is implemented and tested.*
4. ✅ Hosted tools, approvals, and user-input pauses suspend and resume the same run rather than ending the turn synthetically. — *Same-process continuation works. Restart-safe continuation works for both single-tool (`agent_loop_continue_single_tool`) and multi-tool (`agent_loop_continue_multi_tool`) scenarios.*
5. ✅ Tool results preserve structured `details` as well as rendered content.
6. ✅ Sessions support create, continue, resume-by-id, fork, enumerate, and transcript/history access.
7. ✅ The SDK exposes a hook system covering the SDK-native hook families listed in this spec. — *All 19 SDK-native hooks auto-fire at runtime: model/prompt hooks, `llm_input`/`llm_output`, `agent_end`, tool hooks (`before_tool_call`, `after_tool_call`), persist hooks (`tool_result_persist`, `before_message_write`), session lifecycle (`session_start`, `session_end`), `before_reset`, compaction hooks (`before_compaction`, `after_compaction`), and subagent lifecycle hooks (`subagent_spawning`, `subagent_spawned`, `subagent_ended`).*
8. ✅ Host-bridged hook families can be emitted by the host without reintroducing channel/gateway responsibilities into the SDK. — *`sdk.emitHook(...)` is implemented and tested.*
9. ✅ MCP integration works for local-process and HTTP transports, alongside in-process custom tools.
10. ✅ Subagents are programmatic SDK features with lifecycle support and scoped tool access. — *`subagents` is a core built-in tool with first-class child-session runtime. The SDK internally creates a child `GeneralAgentSdkSession` with independent message history, scoped system prompt, scoped tool access (excluding `subagents` itself to prevent recursion), and parent/child coordination. All 4 lifecycle hooks fire: `subagent_spawning` (can block), `subagent_delivery_target`, `subagent_spawned`, `subagent_ended`. Test coverage in `subagent-runtime.test.ts` (3 tests).*
11. ✅ Streaming supports both incremental events and terminal completion semantics suitable for real-time UI consumption.
12. ✅ File checkpointing and rewind are available whenever file mutation tools are enabled.
13. ✅ Missing credentials fail loudly instead of falling back to stub behavior. — *Fully satisfied: without an API key and without a matching hosted-tool path, `streamTurn()` throws a hard error. The old "Acknowledged:" silent stub fallback has been removed. Test coverage in `missing-credentials.test.ts` verifies both the error path and the hosted-tool fallback.*
14. ✅ All VisionClaw compatibility code and exports are removed from the package.
15. ✅ All public naming is standardized on `General Agent SDK` and `GeneralAgent*`.

## 18. Immediate Follow-Up Work

The first implementation plan written from this spec must include:

- removal of VisionClaw compatibility exports and tests
- public API cleanup and rename pass
- migration from simplified local web tools to source-synced OpenClaw tools
- structured tool-result model upgrade
- hosted-tool same-run continuation
- session resume/fork/list/history support
- hook runner migration
- compaction implementation
- loop robustness tests covering multi-step tool use until terminal completion
- checkpointing design and implementation

This spec is the active source of truth for that plan.
