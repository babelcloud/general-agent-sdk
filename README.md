# General Agent SDK

`general-agent-sdk` is a session-first embedded SDK that extracts the agent execution kernel from OpenClaw and exposes it as a host-controlled TypeScript package.

The SDK is intentionally narrow: it preserves execution-layer semantics such as tool calls, hosted-tool suspend/resume, compaction, plugin policy, and provider-specific streaming, while leaving orchestration, channel routing, profile ownership, and canonical session state to the host application.

## Status

- Repository: `https://github.com/babelcloud/general-agent-sdk`
- Package name: `general-agent-sdk`
- Current package version: `0.1.0`
- Runtime: Node.js `>=22.14.0`
- Module format: ESM
- CI workflow: [`.github/workflows/sdk-ci.yml`](./.github/workflows/sdk-ci.yml)

This repository is currently host-oriented and private by default. It is designed to be consumed as a pinned dependency or submodule by a parent host application.

## Breaking Changes

The current General Agent SDK surface intentionally removes earlier transitional names and compatibility entrypoints.

- Root factory/type names are now `createGeneralAgentSdk`, `GeneralAgentSdk`, `GeneralAgentSdkOptions`, and `GeneralAgentSession`.
- The package no longer ships the `./compat/visionclaw` entrypoint.
- The package no longer ships the `./plugin-sdk` alias.

If you are upgrading from an earlier internal prototype, update root imports and switch any host integration that depended on removed subpaths to the native SDK session/event APIs.

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
- Start and stop registered stdio MCP runtimes for active runs
- Emit canonical host-facing logs and optional raw stream events

### Host responsibilities

- Profile roots and workspace roots
- Credentials and environment variables
- Canonical session metadata
- Channel ingress and egress
- Cross-engine continuity and owner-facing orchestration
- Which MCP servers are registered and enabled for a session

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
  tools: {
    web: {
      fetch: {
        firecrawl: {
          apiKey: process.env.FIRECRAWL_API_KEY,
        },
      },
      search: {
        apiKey: process.env.BRAVE_SEARCH_API_KEY,
      },
    },
  },
});
```

### Session creation

```ts
const session = sdk.createSession({
  identity: {
    mode: "general",
    sessionId: "sess-general",
    sessionKey: "host:default:general",
  },
  systemPrompt: "Use the finish tool immediately.",
  modelRef: "openai/gpt-5.4",
  sessionFile,
  authProfileId: "enterprise-default",
  rawEventLogPath,
});
```

### Session lifecycle

The SDK can enumerate stored sessions, reopen them by `sessionId`, continue a known identity, fork a stored transcript into a new session, and read persisted transcript history.

```ts
const sessions = await sdk.listSessions();
const resumed = await sdk.resumeSession("sess-general");
const continued = await sdk.continueSession({
  identity: {
    mode: "general",
    sessionId: "sess-general",
    sessionKey: "host:default:general",
  },
});
const forked = await sdk.forkSession("sess-general", {
  identity: {
    mode: "general",
    sessionId: "sess-general-fork",
    sessionKey: "host:default:general-fork",
  },
  sessionFile: forkSessionFile,
});
const history = await sdk.readSessionHistory("sess-general");
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

Hosted tools currently force sequential tool execution inside the vendored loop. That keeps same-run suspend/resume robust for hosted tools such as `finish`.

Across SDK recreation, the runtime can recover both single-tool and multi-tool hosted-tool suspensions. When the assistant issues multiple tool calls and one is a hosted tool, the SDK snapshots the full context and resumes correctly after restart.

### Hooks

The SDK now exposes an OpenClaw-aligned hook surface for embedded-agent flows. Runtime-managed hooks currently include pre-run model/prompt hooks, `llm_input`, `agent_end`, `llm_output`, tool hooks, transcript persist hooks, and session lifecycle hooks. Host-bridged hooks such as `message_sending`, `message_sent`, `message_received`, `inbound_claim`, `before_dispatch`, `gateway_start`, and `gateway_stop` can be emitted directly through the SDK.

```ts
const result = await sdk.emitHook({
  hookName: "message_sending",
  event: {
    to: "channel:123",
    content: "hello",
  },
  context: {
    channelId: "discord",
  },
});
```

The public hook registry accepts the full `GeneralAgentHookRegistration` union, including:

- `before_model_resolve`
- `before_prompt_build`
- `before_agent_start`
- `llm_input`
- `llm_output`
- `agent_end`
- `before_compaction`
- `after_compaction`
- `before_reset`
- `inbound_claim`
- `message_received`
- `message_sending`
- `message_sent`
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
- `gateway_start`
- `gateway_stop`
- `before_dispatch`

All SDK-native hooks listed above are now auto-emitted by the runtime at the appropriate lifecycle points. This includes `before_reset`, compaction hooks (`before_compaction` / `after_compaction`), and subagent lifecycle hooks (`subagent_spawning` / `subagent_delivery_target` / `subagent_spawned` / `subagent_ended`). Host-bridged hooks such as `gateway_start`, `gateway_stop`, `inbound_claim`, `message_received`, `message_sending`, `message_sent`, and `before_dispatch` remain available through the `sdk.emitHook(...)` dispatch path.

### Dynamic MCP servers

The session can register dynamic MCP servers. The current runtime supports local `stdio` MCP servers and injects their tools into the same vendored loop as built-ins and hosted tools.

```ts
session.setDynamicMcpServers({
  echo_server: {
    transport: "stdio",
    command: process.execPath,
    args: ["/abs/path/to/echo-server.mjs"],
  },
});

const query = session.getCurrentQuery();
const status = await query?.mcpServerStatus?.();
await query?.toggleMcpServer?.("echo_server", false);
```

Both MCP transport modes are supported:

- `stdio`: local process servers
- `http`: remote HTTP-based MCP endpoints

Example with `http` transport:

```ts
session.setDynamicMcpServers({
  remote_server: {
    transport: "http",
    url: "https://mcp.example.com/api",
    headers: { Authorization: "Bearer token" },
  },
});
```

### Session reset

A session can be reset to clear its message history, usage state, and pending hosted-tool state while preserving the session identity and configuration. This is useful when the host wants to start fresh within the same session without creating a new one.

```ts
await session.reset("context_overflow");
```

The reset fires a `before_reset` hook before clearing state, allowing hooks to observe the outgoing transcript.

### Compaction

The SDK supports runtime compaction to manage context window pressure. Compaction can be triggered manually or automatically based on token usage thresholds.

```ts
// Manual compaction
await session.requestCompaction();

// Automatic compaction when usage exceeds threshold
await session.maybeCompactByTokens({
  usedPctThreshold: 85,  // compact when context is 85% full
  cooldownMs: 60_000,    // minimum 60s between compactions
});
```

Compaction truncates older messages and replaces them with a concise summary, keeping the most recent conversation context intact. The SDK emits `compaction_started` and `compaction_finished` stream events and fires `before_compaction` / `after_compaction` hooks during the process.

The context window size is resolved dynamically based on the model (e.g., 200K for Claude models, 128K for GPT-4o, 1M+ for Gemini models).

### Subagents

The `subagents` tool is a first-class core built-in. When the agent calls it, the SDK automatically creates a child `GeneralAgentSdkSession` with:

- **Independent message history** — the child session has its own transcript, isolated from the parent
- **Scoped instructions** — the child receives its own system prompt via the `instructions` parameter
- **Scoped tool access** — the child inherits the parent's tools except `subagents` itself (preventing infinite recursion). An optional `allowedTools` parameter further restricts the child's tool set.
- **Parent/child coordination** — the parent's agent loop blocks while the child runs to completion, then receives the child's output as the tool result

All 4 subagent lifecycle hooks fire automatically:
- `subagent_spawning` — before creation (can block with `{ status: "error" }`)
- `subagent_delivery_target` — after creation, before execution
- `subagent_spawned` — after child session is ready
- `subagent_ended` — after child completes (with `outcome: "ok"` or `"error"`)

### File checkpoints

File mutation tools automatically create SDK-managed checkpoints before successful `write`, `edit`, and `apply_patch` calls. Checkpoints are Git-independent and can be rewound through the session API.

```ts
const checkpoints = await session.listCheckpoints();
await session.restoreCheckpoint(checkpoints[0]!.id);
```

Restoring a checkpoint rewinds that checkpoint and any newer checkpoints, so rollback stays linear and predictable.

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

The host is expected to normalize these events into its own runtime contract when necessary.

## Persistence Model

The SDK does not own canonical session identity. Instead, the host provides a `sessionStore` adapter and resolves the session file path explicitly.

Key persistence properties:

- provider-specific transcripts are allowed
- provider-specific raw stream logs are allowed
- both must remain under host-owned directories
- session identity must come from the host
- no parallel SDK-owned global session registry is introduced
- pending hosted-tool wait states and reconstructible continuation snapshots may be persisted when the runtime can resume them safely

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
- `tools?.web?.fetch?: GeneralAgentWebFetchToolOptions`
- `tools?.web?.search?: GeneralAgentWebSearchToolOptions`

This makes the host's trust boundary explicit. The SDK can preserve OpenClaw's plugin and tool semantics, but the host decides how much of that surface is enabled in embedded mode.

`web_search` is now assembled as a built-in tool by default. Internally it follows a source-synced provider runtime: Brave is selected when credentials are available, and the SDK keeps the tool present by falling back to the bundled keyless DuckDuckGo provider when no Brave key is configured.

Plugin scope is intentionally narrow: in this repository, plugin controls are reserved for web-related capabilities only. General-purpose non-web plugin loading is not a product goal for the SDK; other extensibility should go through built-in tools, hosted tools, MCP, or hooks.

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

- copied upstream snapshots live under `src/upstream/openclaw/`
- source-synced adapted files may also live in normal SDK paths such as `src/tools/` and `src/security/`
- each extracted file is tracked in [`manifests/upstream-provenance.json`](./manifests/upstream-provenance.json)
- provenance can be revalidated with `node scripts/verify-upstream-snapshot.mjs`

This is a hard boundary, not just documentation.

## Host Integration

A host application typically keeps the following responsibilities outside the SDK:

- canonical `session.json`
- dual-session switching
- channel ingress and owner notifications
- cross-engine continuity journal
- top-level profile and environment management

That design keeps the General Agent SDK as an execution backend rather than turning the host into an OpenClaw runtime shell.

## Specifications and Implementation Notes

- Design spec: [`docs/superpowers/specs/2026-03-31-general-agent-sdk-source-sync-design.md`](./docs/superpowers/specs/2026-03-31-general-agent-sdk-source-sync-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-03-31-general-agent-sdk-source-sync.md`](./docs/superpowers/plans/2026-03-31-general-agent-sdk-source-sync.md)

These documents are the source of truth for architecture, boundary rules, continuity requirements, and integration sequencing.
