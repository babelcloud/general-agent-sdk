# General Agent SDK Source-Sync Implementation Plan

Date: 2026-03-31
Location: `/Users/apple/programme/funny_projects/openclaw_agent_sdk`
Status: ✅ Complete (all gates passed)
Related spec: `docs/superpowers/specs/2026-03-31-general-agent-sdk-source-sync-design.md`
Recommended execution mode: Subagent-Driven (Agent Teams)

## 0. Current Task List

Last updated: 2026-03-31 (final — all workstreams complete, all review gates passed, all 15 acceptance criteria satisfied)

This section is the maintained execution list. It is intentionally shorter and stricter than the full plan below.

### Completed

- [x] Remove shipped VisionClaw compatibility exports and distribution expectations.
- [x] Rename the public surface to `General Agent SDK` / `GeneralAgent*`.
- [x] Remove the published `./plugin-sdk` export.
- [x] Add `continueSession`, `resumeSession`, `forkSession`, `listSessions`, and `readSessionHistory`.
- [x] Preserve structured tool-result `details` through runtime adaptation.
- [x] Add file checkpoints for `write`, `edit`, and `apply_patch`.
- [x] Add core built-ins `apply_patch`, `web_search`, and `web_fetch`.
- [x] Add an explicit tool catalog and runtime classification table.
- [x] Add MCP `stdio` runtime and persisted MCP server enablement state.
- [x] Add MCP `http` transport to the dynamic MCP runtime.
- [x] Add OpenClaw-style public hook types plus host-emitted `sdk.emitHook(...)`.
- [x] Make same-process hosted-tool continuation resume the same run across multiple tool calls.
- [x] Auto-fire runtime `llm_input`, `agent_end`, and `llm_output` hook events.
- [x] Add public `session.reset(reason?)` with a live reset seam.
- [x] Auto-fire runtime `before_reset` hook events.
- [x] Add restart-safe hosted-tool continuation for safely reconstructible single-tool suspensions.
- [x] Auto-fire `before_model_resolve`, `before_prompt_build`, `before_agent_start` hook events.
- [x] Auto-fire `before_tool_call`, `after_tool_call`, `tool_result_persist`, `before_message_write` hook events.
- [x] Auto-fire `session_start` and `session_end` hook events.
- [x] Implement working compaction runtime with truncation-based summarization, `before_compaction`/`after_compaction` hook auto-emission, and `compaction_started`/`compaction_finished` stream events.
- [x] Replace hardcoded 200K context window with model-aware dynamic resolution via `resolveContextWindow()`.
- [x] Broaden restart-safe hosted-tool continuation to support multi-tool scenarios via `agent_loop_continue_multi_tool` strategy.
- [x] Wire subagent lifecycle hook auto-emission (`subagent_spawning`, `subagent_spawned`, `subagent_ended`) into the hosted-tool-bridge execution path for the `subagents` tool.
- [x] Sync README/examples/package docs: fix stale MCP `http` claim, add `session.reset()` documentation, add compaction documentation, update hosted-tool continuation description, update subagent hook status.
- [x] Wire `getSteeringMessages` and `getFollowUpMessages` callbacks into `agentLoop()` and `agentLoopContinue()` calls.
- [x] Add transcript repair/validation via `sanitizeMessages()` before compaction and at the start of each vendored loop run.
- [x] Replace hardcoded `"openai/gpt-5.4"` fallback with `DEFAULT_MODEL_REF` constant in `sdk-factory.ts`.
- [x] Add acceptance tests: context window resolution (7 tests), compaction integration (3 tests), session reset (3 tests).
- [x] Add missing-credentials acceptance test and fix §16 compliance: removed silent "Acknowledged:" stub fallback; `streamTurn()` now throws hard error when no API key and no hosted-tool match (2 tests).
- [x] Harden `session-metadata-index.ts` JSON parsing: `readIndex()` and `readTranscriptHistory()` now gracefully handle empty/corrupted files instead of crashing.
- [x] Workstream 7.3 full repository verification: `check` ✅, `build` ✅, `test` (130 tests / 35 files) ✅, `test:e2e` (package smoke) ✅, `verify-upstream-snapshot` (29 provenance entries) ✅.
- [x] Implement first-class subagent runtime: `subagents` upgraded from host-bridged to core built-in with internal child session creation, independent message history, scoped tools (excluding `subagents` to prevent recursion), parent/child coordination, and all 4 lifecycle hooks connected (`subagent_spawning`, `subagent_delivery_target`, `subagent_spawned`, `subagent_ended`). Test coverage: 3 integration tests.
- [x] Final verification: `check` ✅, `build` ✅, `test` (133 tests / 36 files) ✅, `test:e2e` ✅, `verify-upstream-snapshot` ✅.

### Remaining Local Behavioral Seams (Low Priority)

Only one low-severity seam remains:

| Seam | Location | Severity | Notes |
|---|---|---|---|
| Simplified toolExecution strategy | `sdk-session.ts` — `sequential` if hostedTools exist, else `undefined` | Low | Functional but not upstream-aligned; upstream uses model compatibility and sandbox context to decide |

All previously tracked medium-severity seams (steering messages, transcript repair, hardcoded model, hardcoded context window) have been resolved.

### Next Priority Queue

1. ~~**First-class subagent runtime**~~ → ✅ DONE. `subagents` is now a core built-in with first-class child-session runtime.
2. **Upgrade compaction to LLM-based summarization** when the truncation approach proves insufficient for deep conversations.
3. **Upstream-aligned toolExecution strategy** — resolve tool execution mode from model compatibility instead of hosted-tool presence heuristic.

### Known Gaps Against The Acceptance Bar

Mapped to design spec §17 acceptance criteria:

| § | Criterion | Status | Gap |
|---|---|---|---|
| 1 | Autonomous multi-step tool/model execution | ✅ Satisfied | — |
| 2 | `web_search` and `web_fetch` source-synced built-ins | ✅ Satisfied | — |
| 3 | Every tool explicitly classified | ✅ Satisfied | Tool catalog with `core`/`optional`/`host-bridged`/`out-of-scope` classification exists |
| 4 | Hosted tools/approvals suspend and resume same run | ✅ Satisfied | Same-process and restart-safe continuation works for both single-tool and multi-tool scenarios |
| 5 | Tool results preserve structured `details` | ✅ Satisfied | — |
| 6 | Sessions: create/continue/resume/fork/enumerate/history | ✅ Satisfied | — |
| 7 | Hook system covering SDK-native hook families | ✅ Satisfied | All 19 SDK-native hooks auto-fire: model/prompt hooks, llm_input/output, agent_end, tool hooks, persist hooks, session lifecycle, compaction hooks, reset hooks, and subagent lifecycle hooks |
| 8 | Host-bridged hook emission without channel/gateway | ✅ Satisfied | `sdk.emitHook(...)` works for all host-bridged families |
| 9 | MCP for local-process and HTTP transports | ✅ Satisfied | — |
| 10 | Subagents with lifecycle support | ✅ Satisfied | `subagents` is a core built-in with first-class child-session runtime, independent message history, scoped tools, parent/child coordination, and all 4 lifecycle hooks. |
| 11 | Streaming with incremental and terminal events | ✅ Satisfied | — |
| 12 | File checkpointing and rewind | ✅ Satisfied | — |
| 13 | Missing credentials fail loudly | ✅ Satisfied | Without API key + no hosted-tool match: `streamTurn()` throws hard error. Old "Acknowledged:" stub removed. Test coverage in `missing-credentials.test.ts`. |
| 14 | VisionClaw removed | ✅ Satisfied | — |
| 15 | Public naming on `GeneralAgent*` | ✅ Satisfied | — |

**Summary: 15 of 15 acceptance criteria fully satisfied. 0 partially satisfied.**

**All 7 review gates passed. 133 tests, package smoke, and upstream provenance check all green. Plan status: COMPLETE.**

## 1. Objective

Execute the source-sync design spec by converting the current repository from a partly simplified, partly archival prototype into a production `general-agent-sdk` that:

- removes all VisionClaw coupling from the shipped package
- standardizes public naming on `GeneralAgent*`
- upgrades the runtime to follow OpenClaw's real embedded seam
- ships source-synced core tools including `web_search` and `web_fetch`
- migrates OpenClaw's hook runtime into the SDK
- makes hosted-tool and approval pauses resume the same run
- adds durable sessions, subagents, MCP, and checkpointing to the public SDK surface

Plugin scope is intentionally constrained: only web-related capabilities should continue to use a plugin seam. Non-web SDK work should not expand the plugin surface further.

## 2. Scope Split

This plan is split into seven executable workstreams. Each workstream produces a working, testable slice.

1. Product boundary cleanup
2. Runtime kernel realignment
3. Session lifecycle and continuation
4. Tool surface source-sync
5. Hook runner migration
6. MCP, subagents, and checkpointing
7. Documentation, packaging, and verification

These workstreams are sequenced so later phases build on stable earlier seams, but several tasks inside each workstream can be dispatched in parallel to Agent Teams once the write scopes are separated.

## 3. File Map

### Public API and packaging

- `package.json`
- `README.md`
- `src/index.ts`
- `src/public/sdk.ts`
- `src/public/session.ts`
- `src/public/types.ts`
- `src/public/events.ts`
- `src/public/host-tools.ts`
- `src/public/persistence.ts`
- `examples/smoke-test.ts`

### Current runtime to be realigned

- `src/core/embedded-runner/sdk-factory.ts`
- `src/core/embedded-runner/sdk-session.ts`
- `src/core/embedded-runner/agent-event-adapter.ts`
- `src/core/embedded-runner/hosted-tool-bridge.ts`
- `src/core/embedded-runner/model-from-ref.ts`
- `src/core/normalization/upstream-events.ts`
- `src/core/sessions/session-store.ts`
- `src/core/tools/tool-policy.ts`
- `src/loop/agent-loop.ts`
- `src/loop/agent-types.ts`
- `src/tools/**/*`

### Upstream-derived runtime to make live

- `src/upstream/openclaw/agents/**/*`
- `src/upstream/openclaw/plugins/**/*`
- any new internal bridge files needed under `src/core/openclaw-sync/` or equivalent

### Tests that must change

- `tests/contract/public-api.test.ts`
- `tests/contract/upstream-provenance.test.ts`
- `tests/contract/visionclaw-compat.test.ts`
- `tests/integration/standalone-session.test.ts`
- `tests/integration/plugins-and-tools.test.ts`
- `tests/integration/visionclaw-compat-session.test.ts`
- `tests/integration/persistence-and-logging.test.ts`
- `tests/integration/distribution-and-ci.test.ts`
- new tests under `tests/integration/` and `tests/contract/` for hooks, sessions, MCP, subagents, checkpoints, and source-synced tools

## 4. Workstream 1: Product Boundary Cleanup

Goal: remove shipped VisionClaw coupling, remove stale exports, and lock the public API onto `GeneralAgent*`.

### Task 1.1: Rename the public SDK factory and types

Files:

- `src/public/sdk.ts`
- `src/public/session.ts`
- `src/index.ts`
- `tests/contract/public-api.test.ts`
- `README.md`
- `examples/smoke-test.ts`

Changes:

- Rename `createGeneralAgentAgentSdk` to `createGeneralAgentSdk`.
- Rename `GeneralAgentAgentSdk` to `GeneralAgentSdk`.
- Rename `GeneralAgentAgentSdkOptions` to `GeneralAgentSdkOptions`.
- Rename `GeneralAgentAgentSession` to `GeneralAgentSession`.
- Update all tests and examples to use the new names.

Verification:

```bash
pnpm run check
pnpm exec vitest run tests/contract/public-api.test.ts
```

Expected result:

- TypeScript passes.
- `tests/contract/public-api.test.ts` passes with the renamed exports.

### Task 1.2: Remove VisionClaw exports and distribution expectations

Files:

- `package.json`
- `src/compat/visionclaw/index.ts`
- `src/compat/visionclaw/types.ts`
- `src/compat/visionclaw/events.ts`
- `src/compat/visionclaw/session-adapter.ts`
- `tests/contract/visionclaw-compat.test.ts`
- `tests/integration/visionclaw-compat-session.test.ts`
- `tests/integration/distribution-and-ci.test.ts`
- `SDK DOCS/05-visionclaw-compat.ts`

Changes:

- Remove `./compat/visionclaw` from `package.json`.
- Remove the published `compat/visionclaw` implementation files from the repository.
- Delete contract and integration tests that assert the compat surface still exists.
- Update distribution tests so they assert the compat entrypoint is absent.

Verification:

```bash
pnpm run check
pnpm exec vitest run tests/integration/distribution-and-ci.test.ts
```

Expected result:

- Distribution tests no longer expect `dist/compat/visionclaw/index.js`.

### Task 1.3: Remove the legacy `./plugin-sdk` export

Files:

- `package.json`
- `tests/integration/plugins-and-tools.test.ts`

Changes:

- Delete the `./plugin-sdk` export.
- Replace tests that assert it exists with tests that assert the package publishes only the intended SDK entrypoint.

Verification:

```bash
pnpm run check
pnpm exec vitest run tests/integration/plugins-and-tools.test.ts
```

Expected result:

- Packaging tests pass without any `plugin-sdk` export.

## 5. Workstream 2: Runtime Kernel Realignment

Goal: stop treating `src/upstream/openclaw` as archival and make a coherent internal runtime built around OpenClaw's embedded seam.

### Task 2.1: Make the upstream-derived runtime compilable

Files:

- `tsconfig.json`
- `src/upstream/openclaw/**/*`
- new bridge files under `src/core/openclaw-sync/` as needed

Changes:

- Remove `src/upstream/**/*` from `tsconfig.json` exclusion once the imported subset is coherent.
- Add the missing internal bridge modules needed to satisfy imports from the vendored embedded path.
- Do not expose these files publicly through `src/index.ts`.

Verification:

```bash
pnpm run check
```

Expected result:

- The vendored subset type-checks as part of the repository build.

### Task 2.2: Replace the current runtime entrypoint with an OpenClaw-seam-backed factory

Files:

- `src/core/embedded-runner/sdk-factory.ts`
- `src/core/embedded-runner/sdk-session.ts`
- `src/core/openclaw-sync/**/*`

Changes:

- Introduce an internal runtime wrapper around the source-synced embedded seam.
- Stop using the current `sdk-session.ts` as the behavioral source of truth.
- Keep the public `GeneralAgentSession` shape, but route calls into the OpenClaw-aligned runtime.

Verification:

```bash
pnpm run check
pnpm exec vitest run tests/integration/standalone-session.test.ts
```

Expected result:

- A basic standalone session still streams a run successfully through the new runtime path.

### Task 2.3: Replace the thin tool result model

Files:

- `src/tools/tool-interface.ts`
- `src/core/embedded-runner/sdk-session.ts`
- `src/core/embedded-runner/agent-event-adapter.ts`
- any new internal adapter files that map OpenClaw/pi tool result payloads into SDK events

Changes:

- Extend `GeneralAgentToolResult` so it preserves structured `details`.
- Stop discarding `details` when adapting local or upstream tool results into loop/runtime messages.
- Ensure event normalization still emits user-facing content while keeping structured payloads available to session persistence and hooks.

Verification:

```bash
pnpm run check
pnpm exec vitest run tests/unit/tools/tool-interface.test.ts
```

Expected result:

- Tool interface tests pass with structured result support.

## 6. Workstream 3: Session Lifecycle and Continuation

Goal: make sessions durable, resumable, and capable of pausing and continuing the same run.

### Task 3.1: Replace synthetic hosted-tool completion with same-run continuation

Files:

- `src/core/embedded-runner/sdk-session.ts`
- `src/core/embedded-runner/hosted-tool-bridge.ts`
- `src/core/normalization/upstream-events.ts`
- `tests/integration/standalone-session.test.ts`

Changes:

- Remove the current `tool_result + turn_complete` synthetic resume path.
- Persist a wait state for pending hosted tools.
- Resume the same run when `submitHostedToolResult()` or `submitHostedToolError()` is called.

Verification:

```bash
pnpm exec vitest run tests/integration/standalone-session.test.ts
```

Expected result:

- The resumed stream contains continued assistant activity after the hosted tool result, not immediate synthetic completion.

### Task 3.2: Persist enough session state for restart-safe resume

Files:

- `src/public/persistence.ts`
- `src/core/sessions/session-store.ts`
- `src/core/embedded-runner/sdk-session.ts`
- new tests under `tests/integration/`

Changes:

- Extend stored session metadata to include model/runtime state needed for:
  - resume by id
  - hosted-tool wait state
  - continue latest
  - fork source identity
- Keep transcript path and usage snapshot, but stop limiting persistence to those fields alone.

Verification:

```bash
pnpm exec vitest run tests/integration/persistence-and-logging.test.ts
```

Expected result:

- Restart-safe session state is persisted and restored.

### Task 3.3: Add public session management APIs

Files:

- `src/public/sdk.ts`
- `src/public/session.ts`
- `src/public/types.ts`
- `src/core/embedded-runner/sdk-factory.ts`
- `src/core/embedded-runner/sdk-session.ts`
- new tests under `tests/contract/` and `tests/integration/`

Changes:

- Add APIs for:
  - continue latest
  - resume by session id
  - fork by session id
  - list stored sessions
  - read transcript/history

Verification:

```bash
pnpm run check
pnpm exec vitest run tests/contract
pnpm exec vitest run tests/integration
```

Expected result:

- New contract tests cover session enumeration and resume/fork semantics.

### Task 3.4: Fix multi-turn memory continuity

Files:

- `src/loop/agent-loop.ts`
- `src/core/embedded-runner/sdk-session.ts`
- new regression tests under `tests/integration/`

Changes:

- Ensure the runtime carries forward the updated message state produced by each completed run.
- Add a regression test where the second user turn depends on a fact established in the first turn.

Verification:

```bash
pnpm exec vitest run tests/integration
```

Expected result:

- The multi-turn continuity regression stays green.

## 7. Workstream 4: Tool Surface Source-Sync

Goal: replace simplified local tool implementations with OpenClaw-synced SDK tools and explicitly classify the full tool surface.

### Task 4.1: Add `apply_patch` as a core built-in tool

Files:

- new `src/tools/file/apply-patch.ts` or source-synced equivalent
- `src/tools/tool-assembly.ts`
- tests under `tests/unit/tools/` and `tests/integration/`

Changes:

- Port the upstream `apply_patch` behavior into the SDK as a built-in tool.
- Add assembly and tests.

Verification:

```bash
pnpm exec vitest run tests/unit/tools
```

Expected result:

- `apply_patch` is available in the default core tool set.

### Task 4.2: Replace `web_search` with the source-synced OpenClaw implementation

Files:

- `src/tools/web/web-search.ts`
- any required OpenClaw web-search runtime files vendored into the build
- `src/tools/tool-assembly.ts`
- tests under `tests/integration/`

Changes:

- Remove the Brave-only helper.
- Port the provider/runtime-based OpenClaw implementation.
- Keep the public SDK behavior stable while upgrading internals.

Verification:

```bash
pnpm exec vitest run tests/integration
```

Expected result:

- `web_search` no longer disappears just because one ad hoc env var is missing.

### Task 4.3: Replace `web_fetch` with the source-synced OpenClaw implementation

Files:

- `src/tools/web/web-fetch.ts`
- any required fetch/readability/runtime support files
- `tests/unit/tools/ssrf.test.ts`
- new integration tests for extraction modes

Changes:

- Replace the current tag-stripping implementation with the OpenClaw behavior.
- Preserve guarded fetch and SSRF protection.
- Align extraction modes and structured result semantics to upstream.

Verification:

```bash
pnpm exec vitest run tests/unit/tools/ssrf.test.ts
pnpm exec vitest run tests/integration
```

Expected result:

- `web_fetch` behavior matches the upstream extraction contract.

### Task 4.4: Add a tool catalog and classification table to the runtime

Files:

- new `src/core/tools/tool-catalog.ts`
- `src/tools/tool-assembly.ts`
- `src/core/tools/tool-policy.ts`
- new tests under `tests/contract/`

Changes:

- Declare each OpenClaw tool as one of:
  - `core built-in`
  - `optional built-in`
  - `host-bridged`
  - `out-of-scope`
- Make the assembly layer consume this classification instead of scattered ad hoc decisions.
- Keep plugin-oriented classification narrow: only web capabilities should retain plugin-facing extension seams.

Verification:

```bash
pnpm exec vitest run tests/contract
```

Expected result:

- The tool surface is explicit and testable.

### Task 4.5: Add the optional SDK-suitable built-ins in controlled slices

Files:

- `src/tools/browser/**/*`
- new `src/tools/pdf/**/*`
- new `src/tools/image/**/*`
- new `src/tools/tts/**/*`
- new `src/tools/memory/**/*`
- `src/tools/tool-assembly.ts`
- integration tests per tool family

Changes:

- Land SDK-suitable upstream tools in slices with disjoint write scopes.
- Keep `message`, `gateway`, `cron`, `nodes`, `sessions_list`, `sessions_history`, and `sessions_send` excluded.

Verification:

```bash
pnpm exec vitest run tests/integration
```

Expected result:

- Optional built-ins are either implemented and tested or explicitly marked as deferred with tracked blockers.

## 8. Workstream 5: Hook Runner Migration

Goal: migrate OpenClaw's hook runner into the SDK and expose a general SDK hook model.

### Task 5.1: Vendor the hook runner and hook type system into live internal code

Files:

- new `src/core/hooks/**/*`
- any required vendored hook files from OpenClaw plugins runtime
- `src/public/types.ts` or new public hook types file

Changes:

- Introduce a live hook runner based on the OpenClaw implementation.
- Preserve the upstream distinction between modifying, claiming, void, and synchronous persist hooks.

Verification:

```bash
pnpm run check
```

Expected result:

- Hook runner code builds as part of the repository.

### Task 5.2: Wire SDK-native hook events into runtime execution

Files:

- `src/core/embedded-runner/sdk-session.ts`
- `src/core/openclaw-sync/**/*`
- `src/core/hooks/**/*`
- new hook integration tests

Changes:

- Emit and consume these hook families in the runtime:
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

Verification:

```bash
pnpm exec vitest run tests/integration
```

Expected result:

- Runtime tests demonstrate hook invocation and lifecycle ordering.

### Task 5.3: Add host-bridged hook emission

Files:

- `src/public/sdk.ts`
- `src/public/session.ts`
- new public hook API files
- tests under `tests/contract/`

Changes:

- Add a host-facing API for emitting non-SDK-native hook events into the same hook runner.
- Support:
  - `inbound_claim`
  - `message_received`
  - `message_sending`
  - `message_sent`
  - `gateway_start`
  - `gateway_stop`
  - `before_dispatch`

Verification:

```bash
pnpm exec vitest run tests/contract
```

Expected result:

- Host code can emit these events without reintroducing a shipped gateway runtime.

## 9. Workstream 6: MCP, Subagents, and Checkpointing

Goal: land the remaining capability classes needed for SDK-tier parity.

### Task 6.1: Add MCP runtime support

Files:

- new `src/core/mcp/**/*`
- `src/public/sdk.ts`
- `src/public/session.ts`
- tests under `tests/integration/`

Changes:

- Add APIs for registering MCP servers from local processes and HTTP endpoints.
- Make MCP tools participate in the same permission, hook, and event flows as built-ins.

Verification:

```bash
pnpm exec vitest run tests/integration
```

Expected result:

- MCP-backed tools can be called through the same agent loop.

### Task 6.2: Add public subagent APIs and runtime support

Files:

- `src/public/sdk.ts`
- `src/public/session.ts`
- `src/core/subagents/**/*`
- `src/core/hooks/**/*`
- tests under `tests/integration/`

Changes:

- Expose subagent creation and lifecycle APIs.
- Wire subagent hooks and scoped tool access.
- Decide whether `subagents` remains a built-in tool, a public API, or both.

Verification:

```bash
pnpm exec vitest run tests/integration
```

Expected result:

- The main agent can dispatch a subagent and observe lifecycle events.

### Task 6.3: Add checkpointing and rewind for file mutation tools

Files:

- new `src/core/checkpoints/**/*`
- `src/tools/file/write.ts`
- `src/tools/file/edit.ts`
- new `src/tools/file/apply-patch.ts`
- tests under `tests/integration/`

Changes:

- Create file checkpoints before mutating operations.
- Expose checkpoint list and restore behavior through public SDK APIs.
- Keep checkpointing Git-independent.

Verification:

```bash
pnpm exec vitest run tests/integration
```

Expected result:

- Integration tests can restore the pre-edit filesystem state after agent edits.

## 10. Workstream 7: Documentation, Packaging, and Verification

Goal: make the package shippable and ensure the implemented behavior is the documented behavior.

### Task 7.1: Rewrite README and examples to match the real public API

Files:

- `README.md`
- `examples/smoke-test.ts`
- `SDK DOCS/README.md`

Changes:

- Remove VisionClaw-first framing.
- Replace stale factory names.
- Document the actual General Agent SDK session model and capability set.

Verification:

```bash
pnpm run check
```

Expected result:

- Examples compile and match exported symbols.

### Task 7.2: Add end-to-end capability tests for acceptance criteria

Files:

- new tests under `tests/integration/`
- new tests under `tests/contract/`

Changes:

- Add explicit regression coverage for:
  - multi-step loop until completion
  - hosted-tool same-run continuation
  - session resume/fork/list/history
  - hook invocation
  - MCP tools
  - subagents
  - checkpoints
  - source-synced `web_search` and `web_fetch`
  - hard-fail on missing credentials

Verification:

```bash
pnpm run test
```

Expected result:

- Acceptance behavior is covered by automated tests rather than only docs.

### Task 7.3: Run full repository verification

Commands:

```bash
pnpm run check
pnpm run build
pnpm run test
pnpm run test:e2e
node scripts/verify-upstream-snapshot.mjs
```

Expected result:

- All checks pass.
- The built package contains only the intended distribution surface.

## 11. Parallel Dispatch Plan

Once Workstream 1 is complete, dispatch work with these disjoint ownership slices:

1. Worker A: public API and packaging
   Files:
   - `package.json`
   - `src/public/*`
   - `src/index.ts`
   - `README.md`
   - `examples/smoke-test.ts`

2. Worker B: session/runtime continuation
   Files:
   - `src/core/embedded-runner/*`
   - `src/core/sessions/*`
   - `src/core/normalization/*`

3. Worker C: core tools and tool-result model
   Files:
   - `src/tools/**/*`
   - `src/core/tools/*`

4. Worker D: hook runtime
   Files:
   - `src/core/hooks/**/*`
   - hook-related runtime wiring

5. Worker E: MCP, subagents, checkpoints
   Files:
   - `src/core/mcp/**/*`
   - `src/core/subagents/**/*`
   - `src/core/checkpoints/**/*`

Workers must not revert each other's edits and should re-read touched files before patching if earlier work has landed.

## 12. Review Gates

Do not move past each gate until its verification is green:

1. Gate A: public rename + package export cleanup — ✅ Passed
2. Gate B: runtime seam compiles and standalone session still runs — ✅ Passed
3. Gate C: hosted-tool same-run continuation + durable session state — ✅ Passed
4. Gate D: source-synced core tools + structured tool results — ✅ Passed
5. Gate E: hook runner migration — ✅ Passed
6. Gate F: MCP + subagents + checkpoints — ✅ Passed (subagents host-bridged with lifecycle hooks; first-class runtime deferred to v2)
7. Gate G: full repo verification — ✅ Passed (130 tests, package smoke, provenance check all green)

## 13. Recommended First Execution Batch

The first execution batch should be:

1. Workstream 1.1
2. Workstream 1.2
3. Workstream 1.3
4. Workstream 2.1
5. Workstream 2.3

Reason:

- it removes the public drift first
- it unblocks all later runtime work
- it avoids mixing product-boundary cleanup with hosted-tool/session semantics too early

After that batch is green, move immediately into Workstream 2.2 and Workstream 3.1.
