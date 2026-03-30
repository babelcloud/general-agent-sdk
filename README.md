# General Agent SDK

`general-agent-sdk` is a session-first embedded SDK that extracts the agent execution kernel from OpenClaw and exposes it as a host-controlled TypeScript package.

The primary host target is VisionClaw, where this SDK serves as a third execution backend alongside the Claude Agent SDK and the OpenAI Agents SDK. The SDK is intentionally narrow: it preserves execution-layer semantics such as tool calls, hosted-tool suspend/resume, compaction, plugin policy, and provider-specific streaming, while leaving orchestration, channel routing, profile ownership, and canonical session state to the host.

## Status

- Repository: `https://github.com/babelcloud/general-agent-sdk`
- Package name: `general-agent-sdk`
- Current package version: `0.1.0`
- Runtime: Node.js `>=22.14.0`
- Module format: ESM
- CI workflow: [`.github/workflows/sdk-ci.yml`](./.github/workflows/sdk-ci.yml)

This repository is currently host-oriented and private by default. It is designed to be consumed as a pinned dependency or submodule by a parent host such as VisionClaw.

## What This SDK Is

- A standalone embedded agent kernel extracted from OpenClaw
- A session factory plus session objects
- A bridge that preserves structured execution semantics instead of flattening everything into text
- A host-integrated runtime that writes all state and logs under host-owned roots

## What This SDK Is Not

- Not the full OpenClaw gateway
- Not a replacement for a host application's outer runtime loop
- Not a second authoritative session registry
- Not a channel manager, cron daemon, control plane, or desktop automation environment

## Design Principles

- **Session-first API**: the host bootstraps the SDK once, then creates and reuses sessions explicitly
- **Host-owned persistence**: the host decides where session files, state files, and raw event logs live
- **Execution fidelity**: tool-call identity, hosted-tool resume boundaries, and tool-result ordering are preserved
- **Failure containment**: the SDK stays behind an engine-gated loader path in the host
- **Traceability**: extracted upstream files are tracked through a provenance manifest and verification scripts

## Host / SDK Boundary

### SDK responsibilities

- Create and reuse agent sessions
- Stream assistant, reasoning, tool, hosted-tool, compaction, and usage events
- Preserve `tool_call`, `tool_result`, and `tool_error` semantics
- Resolve embedded provider/auth/plugin/tool behavior
- Emit canonical host-facing logs and optional raw stream events

### Host responsibilities

- Profile roots and workspace roots
- Credentials and environment variables
- Canonical session metadata
- Channel ingress and egress
- Cross-engine continuity and owner-facing orchestration
- External MCP process lifecycle

This separation is intentional. The SDK does not introduce a new top-level runtime abstraction above the host.

## Public API

The supported API surface is exported from [`src/index.ts`](./src/index.ts) and backed by the files under [`src/public/`](./src/public).

### Factory

```ts
import { createGeneralAgentSdk } from "general-agent-sdk";

const sdk = await createGeneralAgentSdk({
  workspaceDir,
  stateDir,
  agentDir,
  profileId: "default",
  pluginMode: "disabled",
  logger,
  sessionStore,
  hostedTools,
  env: process.env,
});
```

### Session creation

```ts
const session = sdk.createSession({
  identity: {
    mode: "general",
    sessionId: "sess-general",
    sessionKey: "visionclaw:default:general",
  },
  systemPrompt: "Use the finish tool immediately.",
  modelRef: "openai/gpt-5.4",
  sessionFile,
  authProfileId: "enterprise-default",
  rawEventLogPath,
});
```

### Turn streaming

```ts
for await (const event of session.streamTurn({
  role: "user",
  content: [{ type: "text", text: "finish now" }],
})) {
  // host consumes normalized GeneralAgentStreamEvent values
}
```

### Hosted-tool resume

When the SDK emits a hosted-tool call, the host must execute the hosted tool and resume the same session with the same `callId`.

```ts
for await (const event of session.submitHostedToolResult({
  callId,
  output: { ok: true },
})) {
  // resumed stream continues with the same execution context
}
```

## Event Model

`GeneralAgentStreamEvent` currently supports:

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

The host is expected to normalize these events into its own runtime contract when necessary. VisionClaw, for example, adapts them into `AgentStreamMessage` values before applying its outer orchestration logic.

## Persistence Model

The SDK does not own canonical session identity. Instead, the host provides a `sessionStore` adapter and resolves the session file path explicitly.

Key persistence properties:

- provider-specific transcripts are allowed
- provider-specific raw stream logs are allowed
- both must remain under host-owned directories
- session identity must come from the host
- no parallel SDK-owned global session registry is introduced

The persistence adapter lives in [`src/public/persistence.ts`](./src/public/persistence.ts).

## Logging Model

The SDK emits canonical host-facing log events through `GeneralAgentHostLogger`.

Supported log categories:

- `system_prompt`
- `tool_call`
- `tool_result`
- `assistant`
- `system`
- `provider_debug`

The logger can also receive raw structured stream events through `onRawStreamEvent()` when the host wants a low-level audit trail.

## Plugin and Tool Policy

The factory accepts:

- `pluginMode: "disabled" | "allowlisted" | "full-embedded"`
- `enabledPluginIds?: string[]`
- `hostedTools?: GeneralAgentHostedToolDefinition[]`

This makes the host's trust boundary explicit. The SDK can preserve OpenClaw's plugin and tool semantics, but the host decides how much of that surface is enabled in embedded mode.

## Repository Layout

```text
src/
  index.ts                  # top-level export surface
  public/                   # supported public API
  core/                     # SDK-owned runtime implementation
  upstream/openclaw/        # extracted upstream subset only
manifests/
  upstream-provenance.json  # machine-readable provenance map
scripts/
  sync-from-openclaw.mjs
  verify-upstream-snapshot.mjs
tests/
  contract/
  integration/
  unit/
docs/
  superpowers/
    specs/
    plans/
```

## Development

Install dependencies:

```bash
pnpm install
```

Run the main verification steps:

```bash
pnpm run check
pnpm run build
pnpm run test
pnpm run test:e2e
node scripts/verify-upstream-snapshot.mjs
```

## Upstream Provenance

This repository deliberately does not mirror the entire upstream OpenClaw source tree.

Instead:

- only the required embedded subset is copied into `src/upstream/openclaw/`
- each extracted file is tracked in [`manifests/upstream-provenance.json`](./manifests/upstream-provenance.json)
- provenance can be revalidated with `node scripts/verify-upstream-snapshot.mjs`

This is a hard boundary, not just documentation.

## Integration With VisionClaw

VisionClaw consumes this repository as a dedicated dependency/submodule and keeps the following host responsibilities outside the SDK:

- canonical `session.json`
- dual-session switching
- channel ingress and owner notifications
- cross-engine continuity journal
- top-level profile and environment management

That design keeps the General Agent SDK as an execution backend rather than turning VisionClaw into an OpenClaw runtime shell.

## Specifications and Implementation Notes

- Design spec: [`docs/superpowers/specs/2026-03-27-openclaw-agent-sdk-design.md`](./docs/superpowers/specs/2026-03-27-openclaw-agent-sdk-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-03-27-openclaw-agent-sdk.md`](./docs/superpowers/plans/2026-03-27-openclaw-agent-sdk.md)

These documents are the source of truth for architecture, boundary rules, continuity requirements, and integration sequencing.
