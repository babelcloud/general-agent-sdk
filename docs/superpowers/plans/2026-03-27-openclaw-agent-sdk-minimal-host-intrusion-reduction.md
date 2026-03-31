# OpenClaw Agent SDK Minimal Host Intrusion Reduction Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the VisionClaw diff against `origin/main` to the minimum host-owned surface required by the approved OpenClaw SDK spec, while preserving all already-approved behavior and regressions guards.

**Architecture:** Keep the spec's `thin host / thick adapter` direction, but push the boundary further: all OpenClaw protocol, session-bridge, event, and type semantics live in `openclaw-agent-sdk`, while VisionClaw keeps only engine selection, canonical session state, continuity, prompt construction, host tool execution, and package staging. For host-owned behavior that cannot be pushed into the SDK by spec, isolate it into narrow helper modules so the core VisionClaw files stay close to `origin/main`.

**Tech Stack:** TypeScript, Node.js, pnpm, vitest, dynamic ESM imports, git submodules, structural typing, Zod config schemas.

---

## 1. Constraints From The Approved Spec

These are not negotiable; they define what may and may not be pushed into the SDK.

- **Must stay in VisionClaw**
  - canonical `session.json` ownership
  - engine-scoped session ids and continuation cursors
  - cross-engine continuity journal
  - system prompt rendering and prompt-policy decisions
  - actual host tool implementations and permission checks
  - engine selection, package presence checks, submodule/staging/publish flow
  - wake loop, mailbox, channel routing, outer orchestration

- **Must move or remain in the SDK**
  - OpenClaw stream normalization
  - hosted-tool suspend/resume protocol
  - OpenClaw-specific session wrapper logic
  - OpenClaw-specific structural types
  - any glue that exists only because OpenClaw's protocol differs from VisionClaw

- **Must not be introduced**
  - a new top-level runtime platform abstraction
  - a second authoritative session registry outside VisionClaw
  - raw runtime imports from upstream OpenClaw source
  - engine fallback behavior that silently swaps OpenClaw for Claude/OpenAI

## 2. Current State Audit Relative To `origin/main`

Current VisionClaw diff shape is larger than the target steady state. The changed files cluster into three groups:

### 2.1 Unavoidable host-owned changes

- `src/agent/conversation-journal.ts`
- `src/config/index.ts`
- `src/config/types.ts`
- `src/reconfigure.ts`
- `src/agent/loop.ts`
- `src/agent/session-manager.ts`
- `src/agent/runtime-surface.ts`
- `src/agent/providers/engine.ts`
- package/submodule/staging files

These exist because the spec explicitly makes continuity, canonical session identity, runtime selection, and package governance host-owned.

### 2.2 Changes that should still shrink

- `src/agent/providers/openclaw/sdk-types.ts`
- `src/agent/providers/openclaw/session.ts`
- `src/agent/providers/openclaw/sdk-loader.ts`
- `src/agent/providers/openclaw/sdk-factory.ts`
- OpenClaw-specific branches mixed into generic host files

These are the main candidates for further pushback into the SDK or isolation into thin helper modules.

### 2.3 Host-owned logic that is currently too invasive

- `src/agent/stream-handler.ts` currently contains continuity capture inline
- `src/config/index.ts` currently mixes generic config access with engine-scoped session-state storage
- `src/reconfigure.ts` currently inlines the OpenClaw runtime-selection flow
- `src/agent/providers/client-factory.ts` currently absorbs OpenClaw-specific branching directly

These cannot disappear entirely, but they can be isolated so the core files become thinner and closer to the original host shape.

## 3. Approach Options

### Option A: Keep The Current Shape And Only Delete Obvious Duplication

- Delete `sdk-types.ts`
- Keep the rest of the current host layout

**Pros**
- Lowest immediate implementation risk
- Smallest short-term code churn

**Cons**
- Does not materially reduce intrusion into core VisionClaw files
- Leaves too much OpenClaw awareness spread through host code
- Fails the spirit of the approved `thin host / thick adapter` architecture

### Option B: Push OpenClaw Semantics Into The SDK And Isolate Unavoidable Host Features

- Push remaining OpenClaw bridge/type/session glue into `openclaw-agent-sdk/compat/visionclaw`
- Keep host-owned continuity and session-state logic in VisionClaw, but move it into narrowly-scoped helper modules
- Keep existing generic VisionClaw files close to orchestration-only roles

**Pros**
- Matches the approved spec and thin-host plan
- Minimizes long-term compatibility risk
- Reduces future review surface for OpenClaw-related changes
- Keeps continuity and session identity where the spec requires them

**Cons**
- Requires one more round of SDK surface expansion
- Requires a deliberate cleanup pass across both repos

### Option C: Introduce A Generic Engine Plugin Runtime In VisionClaw

- Replace current engine wiring with a broad plugin/runtime registry
- Load all engines through one large extensibility layer

**Pros**
- Potentially fewer one-off conditionals in host code

**Cons**
- Violates the spec's “no second top-level runtime abstraction” direction
- Large refactor surface
- Higher risk than necessary for the approved scope

**Recommendation:** **Option B.** It is the only option that both reduces intrusion and stays aligned with the approved spec and thin-host plan.

## 4. Target End State

After this reduction pass, VisionClaw should contain only:

- packaging/submodule/staging glue for `openclaw-agent-sdk`
- engine registration and config selection
- canonical session/continuity persistence
- actual host tool definitions/execution
- a thin OpenClaw provider folder:
  - `sdk-loader.ts`
  - `sdk-factory.ts`
  - `session.ts`
  - `host-tools.ts`
  - `persistence.ts`

And even inside those files:

- no host-local OpenClaw event normalization
- no host-local hosted-tool resume state machine
- no mirrored SDK public/compat type graph
- no OpenClaw-specific logic mixed into generic stream processing beyond delegating to host-owned continuity observers

## 5. File Map

### SDK repo: `/Users/apple/programme/funny_projects/openclaw_agent_sdk`

- Modify: `src/compat/visionclaw/types.ts`
- Modify: `src/compat/visionclaw/session-adapter.ts`
- Create or modify: `src/compat/visionclaw/index.ts`
- Optional create: `src/compat/visionclaw/provider.ts`
- Modify: `package.json`
- Modify: `tests/contract/visionclaw-compat.test.ts`
- Modify: `tests/integration/visionclaw-compat-session.test.ts`
- Modify: `tests/integration/distribution-and-ci.test.ts`

### VisionClaw repo: `/Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk`

- Modify: `package.json`
- Modify: `scripts/setup-openclaw-shim.mjs`
- Modify: `scripts/stage-openclaw-agent-sdk.mjs`
- Modify: `src/agent/providers/openclaw/sdk-loader.ts`
- Modify: `src/agent/providers/openclaw/sdk-factory.ts`
- Modify: `src/agent/providers/openclaw/session.ts`
- Delete: `src/agent/providers/openclaw/sdk-types.ts`
- Create: `src/agent/continuity-observer.ts`
- Create: `src/config/session-state.ts`
- Create: `src/reconfigure/runtime-selection.ts`
- Modify: `src/agent/stream-handler.ts`
- Modify: `src/config/index.ts`
- Modify: `src/reconfigure.ts`
- Modify: `src/agent/providers/client-factory.ts`

## 6. Workstreams

### Workstream 1: Expand The SDK Compat Surface So VisionClaw Stops Mirroring It

**Intent:** Remove host-local OpenClaw type duplication and reduce `session.ts` to orchestration-only glue.

- Add SDK-owned exports for every structural type VisionClaw currently mirrors locally.
- Extend the compat adapter so the host does not need to implement content translation, usage-snapshot normalization, or session-id attachment itself unless that logic is genuinely host-owned.
- If needed, add one higher-level compat helper whose job is to assemble a VisionClaw-compatible session bridge from:
  - SDK instance
  - session params
  - hosted tool executor
  - initial dynamic MCP state

**Acceptance criteria**
- VisionClaw deletes `src/agent/providers/openclaw/sdk-types.ts`.
- VisionClaw no longer carries any OpenClaw event or session protocol state machine outside `host-tools.ts`.
- Exact tool names like `exec` remain unchanged end-to-end.

### Workstream 2: Make VisionClaw Depend On The SDK Package For Types, Not Mirrors

**Intent:** Stop defining duplicate interfaces in the host repo.

- Add `openclaw-agent-sdk` as the canonical typed dependency source for compile-time imports.
- Keep runtime loading lazy and engine-gated.
- Continue staging the packaged SDK into `dist/vendor/openclaw-agent-sdk` for publish/build.

**Acceptance criteria**
- Host type imports come from `openclaw-agent-sdk` or `openclaw-agent-sdk/compat/visionclaw`, not local mirrors.
- `sdk-loader.ts` resolves the package entrypoint without relying on raw runtime imports from the full upstream OpenClaw repo.

### Workstream 3: Isolate Host-Owned Continuity So Core Stream Processing Stops Growing

**Intent:** Keep continuity in VisionClaw, but stop mixing it into the main stream handler.

- Extract journal append behavior from `stream-handler.ts` into a narrow `continuity-observer.ts` module.
- The observer consumes normalized `AgentStreamMessage` values and appends host-owned continuity entries.
- `stream-handler.ts` becomes orchestration-only again: logging, activity tracking, finish detection, timeout handling.

**Acceptance criteria**
- `stream-handler.ts` contains no OpenClaw-specific branches.
- Continuity still records exact tool names and results for cross-engine continuation.
- Claude/OpenAI behavior remains unchanged.

### Workstream 4: Isolate Engine-Scoped Session State Away From Generic Config Plumbing

**Intent:** Preserve host ownership of canonical session state without leaving `config/index.ts` as the dumping ground.

- Move engine-scoped session id / usage snapshot / continuation cursor storage into `src/config/session-state.ts`.
- Keep `config/index.ts` as the public facade, delegating to the helper.
- Preserve backward-compatible migration from legacy unscoped state.

**Acceptance criteria**
- Continuity and per-engine session identity still survive engine switching.
- `session.json` remains the single authoritative store.
- `config/index.ts` shrinks toward facade behavior instead of containing all session-state internals inline.

### Workstream 5: Isolate Runtime Selection Flow Away From Generic Reconfigure Logic

**Intent:** Keep runtime selection host-owned, but reduce broad edits to `reconfigure.ts`.

- Extract runtime/engine switching prompts and OpenClaw-specific prompt fields into `src/reconfigure/runtime-selection.ts`.
- Keep `reconfigure.ts` as a thin command dispatcher.
- Preserve all currently approved operator-visible flows:
  - choose Claude/OpenAI/OpenClaw
  - choose OpenClaw model ref
  - choose plugin mode
  - choose optional auth profile id
  - scope existing session state before switching engines

**Acceptance criteria**
- No operator-visible feature is lost.
- Runtime-switch logic remains traceable and testable in isolation.

### Workstream 6: Keep `client-factory.ts` And Other Generic Host Files Dispatch-Oriented

**Intent:** Reduce OpenClaw-specific branching inside generic helper files.

- Extract any OpenClaw-only label/env/model resolution helpers into narrow modules or helper functions near the OpenClaw provider.
- Keep `client-factory.ts` focused on dispatching to Claude/OpenAI/OpenClaw paths rather than embedding the details inline.

**Acceptance criteria**
- Generic provider helpers remain readable without knowing OpenClaw internals.
- Failure-containment rules still hold: no OpenClaw bootstrap unless `engine === "openclaw-agent-sdk"`.

## 7. Execution Order

1. Expand SDK compat exports and tests first.
2. Update VisionClaw packaging/dependency setup so it can import SDK types directly.
3. Delete `sdk-types.ts` and thin `session.ts` further.
4. Extract host-owned continuity observer.
5. Extract host-owned session-state helper.
6. Extract runtime-selection helper.
7. Re-run the cross-engine continuity and thin-host verification suite.

This order preserves behavior while continuously shrinking host-specific duplication.

## 8. Verification Gates

The reduction pass is complete only when all of the following are true:

- `pnpm --dir /Users/apple/programme/funny_projects/openclaw_agent_sdk run check`
- `pnpm --dir /Users/apple/programme/funny_projects/openclaw_agent_sdk run test`
- `pnpm --dir /Users/apple/programme/funny_projects/openclaw_agent_sdk run test:e2e`
- `pnpm --dir /Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk run check`
- `pnpm --dir /Users/apple/.config/superpowers/worktrees/visionclaw_repo/feat-openclaw-sdk run test`
- targeted integration tests for:
  - `openclaw-thin-host`
  - `session-manager`
  - `stream-handler`
  - `session`
- packaged VisionClaw build still contains `dist/vendor/openclaw-agent-sdk/dist/compat/visionclaw/index.js`

## 9. Success Criteria

The plan succeeds only if all of these hold simultaneously:

- Relative to `origin/main`, the remaining VisionClaw diff is dominated by host-owned responsibilities required by the spec.
- No OpenClaw protocol or session semantics are reimplemented in VisionClaw.
- No approved feature regresses:
  - engine selection
  - exact tool-name preservation
  - hosted tool suspend/resume
  - cross-engine continuity
  - canonical session identity
  - package staging and rollback traceability
- Future OpenClaw behavior upgrades primarily land in `openclaw-agent-sdk`, with VisionClaw consuming them by submodule bump plus thin host glue adjustments only.
