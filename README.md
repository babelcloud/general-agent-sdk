<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/hero-banner.svg">
  <source media="(prefers-color-scheme: light)" srcset=".github/assets/hero-banner.svg">
  <img alt="General Agent SDK" src=".github/assets/hero-banner.svg" width="100%">
</picture>

<br/>

[![npm](https://img.shields.io/npm/v/general-agent-sdk?style=for-the-badge&logo=npm&logoColor=white&color=CB3837&label=)](https://www.npmjs.com/package/general-agent-sdk)
&nbsp;
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
&nbsp;
[![License](https://img.shields.io/badge/MIT-license-blue?style=for-the-badge)](./LICENSE)
&nbsp;
[![Tests](https://img.shields.io/badge/133-tests_passing-22c55e?style=for-the-badge&logo=vitest&logoColor=white)](./tests)
&nbsp;
[![Node](https://img.shields.io/badge/Node-%E2%89%A522-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)

<br/>

**The TypeScript SDK for building AI agents that call tools, manage sessions, and ship to production.**

[Quick Start](#-get-started-in-60-seconds) · [Architecture](#-architecture) · [API Reference](./SDK%20DOCS/API-REFERENCE.md) · [Examples](./SDK%20DOCS/)

<br/>

</div>

<!-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ -->

## Why General Agent SDK?

Most agent frameworks give you **wrappers around chat completions** — you manage the tool loop, you track the state, you handle restarts. General Agent SDK gives you a **complete execution kernel**:

<div align="center">
<br/>

<img src=".github/assets/why-different.svg" alt="Comparison" width="100%">

<br/><br/>
</div>

> **The SDK runs the agent loop for you.** You send a message, the agent autonomously calls tools, reasons about results, calls more tools, and streams every event back — until it's done or needs your input.

<br/>

<!-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ -->

<div align="center">

<img src=".github/assets/features.svg" alt="Features" width="100%">

</div>

<br/>

<!-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ -->

<div align="center">

<img src=".github/assets/quick-start-header.svg" alt="Quick Start" width="100%">

</div>

### Step 1 — Install

```bash
npm install general-agent-sdk
```

### Step 2 — Set your API key

```bash
export ANTHROPIC_API_KEY="sk-ant-..."

# Optional: use a custom endpoint
# export ANTHROPIC_BASE_URL="https://your-proxy.example.com"
```

### Step 3 — Run your first agent

```typescript
import { createGeneralAgentSdk } from "general-agent-sdk";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";

// 1. Initialize
const sdk = await createGeneralAgentSdk({
  workspaceDir: process.cwd(),
  stateDir:     path.join(process.cwd(), ".agent-state"),
  agentDir:     path.join(process.cwd(), ".agent"),
  profileId:    "default",
  pluginMode:   "disabled",
  logger:       { onDebug() {}, onInfo() {}, onWarn() {}, onError() {} },
  sessionStore: {
    async load() { return null; },
    async save() {},
    async resolveSessionFile(id) {
      return path.join(os.tmpdir(), `${id.sessionId}.jsonl`);
    },
  },
});

// 2. Create a session
const session = sdk.createSession({
  identity:     { mode: "general", sessionId: randomUUID(), sessionKey: "demo" },
  systemPrompt: "You are a helpful assistant. Use tools when needed.",
  modelRef:     "claude-sonnet-4-20250514",
  sessionFile:  path.join(os.tmpdir(), "demo-session.jsonl"),
});

// 3. Stream a turn — the agent calls tools autonomously
for await (const event of session.streamTurn({
  role: "user",
  content: [{ type: "text", text: "List the files in the current directory" }],
})) {
  switch (event.kind) {
    case "assistant_delta":  process.stdout.write(event.text);                           break;
    case "tool_call":        console.log(`\n🔧 ${event.toolName}`);                     break;
    case "tool_result":      console.log(`   ✅ done`);                                 break;
    case "turn_complete":    console.log(`\n\n🏁 Turn complete (${event.stopReason})`);  break;
  }
}

await sdk.shutdown();
```

> **That's it.** The agent autonomously reads the directory, reasons about the output, and streams a formatted answer — all in one `for await` loop.

<br/>

---

<!-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ -->

## 🎯 Core Concepts

### The Event Stream

Every turn returns an `AsyncIterable<GeneralAgentStreamEvent>`. No callbacks, no observers — one loop handles everything:

<div align="center">
<br/>

<img src=".github/assets/event-flow.svg" alt="Event Flow" width="100%">

<br/><br/>
</div>

```typescript
for await (const event of session.streamTurn(input)) {
  switch (event.kind) {
    case "assistant_delta":   // → streaming text from the model
    case "reasoning_delta":   // → model thinking (extended thinking)
    case "tool_call":         // → built-in tool invoked
    case "tool_result":       // → tool returned a result
    case "hosted_tool_call":  // → YOUR tool was requested — SDK suspends ⏸️
    case "usage_snapshot":    // → token usage update
    case "turn_complete":     // → this turn is done ✅
  }
}
```

---

### 🎯 Hosted Tools — Your Code, The Model's Brain

Define tools the AI can call. You implement the logic; the SDK orchestrates the lifecycle:

```typescript
const sdk = await createGeneralAgentSdk({
  // ...
  hostedTools: [{
    name: "get_weather",
    description: "Get current weather for a city",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  }],
});

for await (const event of session.streamTurn(userMsg)) {
  if (event.kind === "hosted_tool_call") {
    //  SDK suspends automatically ⏸️
    const weather = await getWeather(event.input.city);

    //  Resume with your result ▶️
    for await (const e of session.submitHostedToolResult({
      callId: event.callId,
      output: weather,
    })) {
      if (e.kind === "assistant_delta") process.stdout.write(e.text);
    }
    break;
  }
}
```

> **Restart-safe:** Hosted tool pauses survive process restarts. The SDK snapshots context and resumes correctly — even with multi-tool parallel calls.

---

### 💬 Multi-Turn Memory

Sessions automatically maintain conversation history:

```typescript
// Turn 1
for await (const e of session.streamTurn({
  role: "user",
  content: [{ type: "text", text: "My name is Alice. I'm building a TypeScript app." }],
})) { /* ... */ }

// Turn 2 — the agent remembers everything
for await (const e of session.streamTurn({
  role: "user",
  content: [{ type: "text", text: "What's my name and what am I building?" }],
})) { /* ... */ }
// ➜ "Your name is Alice and you're building a TypeScript app."
```

---

### 🪝 Hooks — Intercept Everything

26 hooks let you observe, modify, or block any lifecycle event:

```typescript
const sdk = await createGeneralAgentSdk({
  hooks: [
    // 🔀 Dynamic model routing
    {
      pluginId: "my-app",
      hookName: "before_model_resolve",
      handler: (ev) => ({
        modelOverride: needsPower(ev) ? "claude-opus-4-20250514" : "claude-sonnet-4-20250514",
      }),
    },

    // 🛡️ Safety guardrails
    {
      pluginId: "my-app",
      hookName: "before_tool_call",
      handler: (ev) => {
        if (ev.toolName === "exec" && ev.params.command?.includes("rm -rf"))
          return { block: true, blockReason: "Dangerous command blocked" };
      },
    },

    // 📊 Usage audit trail
    {
      pluginId: "my-app",
      hookName: "llm_output",
      handler: (ev) => {
        db.insert({ model: ev.model, tokens: ev.usage?.input + ev.usage?.output });
      },
    },
  ],
});
```

<details>
<summary><strong>📋 Full hook reference (19 SDK-native + 7 host-bridged)</strong></summary>

<br/>

**SDK-native hooks** — auto-fired by the runtime:

| Hook | Modifiable | Fires when... |
|:-----|:---:|:---|
| `before_model_resolve` | ✅ | Model selection begins |
| `before_prompt_build` | ✅ | System prompt is being assembled |
| `before_agent_start` | ✅ | Agent run is about to begin |
| `llm_input` | — | Request sent to LLM |
| `llm_output` | — | Response received from LLM |
| `agent_end` | — | Agent run completed |
| `before_tool_call` | ✅ | Tool is about to execute |
| `after_tool_call` | — | Tool execution finished |
| `tool_result_persist` | ✅ | Tool result being saved to transcript |
| `before_message_write` | ✅ | Message being written to history |
| `session_start` | — | Session first activated |
| `session_end` | — | Session completed |
| `before_compaction` | — | Context compaction starting |
| `after_compaction` | — | Context compaction finished |
| `before_reset` | — | Session about to clear |
| `subagent_spawning` | ✅ | Child agent creation requested |
| `subagent_delivery_target` | ✅ | Routing child agent delivery |
| `subagent_spawned` | — | Child agent created |
| `subagent_ended` | — | Child agent finished |

**Host-bridged hooks** — you trigger these via `sdk.emitHook()`:

| Hook | Purpose |
|:-----|:--------|
| `inbound_claim` | Incoming message routing |
| `before_dispatch` | Pre-dispatch filtering |
| `message_received` | Message arrival notification |
| `message_sending` | Modify/cancel outgoing messages |
| `message_sent` | Delivery confirmation |
| `gateway_start` | Gateway lifecycle start |
| `gateway_stop` | Gateway shutdown |

</details>

---

### 🔌 MCP Integration

Plug in any [Model Context Protocol](https://modelcontextprotocol.io/) server — tools appear alongside built-ins:

```typescript
session.setDynamicMcpServers({
  // Local process (stdio)
  filesystem: {
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/data"],
  },

  // Remote endpoint (HTTP)
  my_api: {
    transport: "http",
    url: "https://mcp.example.com/api",
    headers: { Authorization: "Bearer token" },
  },
});
```

---

### 🤖 Subagents

The agent can spawn scoped child agents to divide and conquer complex tasks:

```typescript
const session = sdk.createSession({
  systemPrompt: `You are a tech lead. Delegate tasks using the subagents tool.`,
  // ...
});

// The agent will autonomously:
// 1. Analyze the task
// 2. Spawn child agents with scoped instructions + tools
// 3. Collect results from each child
// 4. Synthesize a final answer
```

Each child gets **independent message history** and **scoped tool access**. The `subagents` tool is excluded from children to prevent infinite recursion. Four lifecycle hooks fire automatically: `subagent_spawning` → `subagent_spawned` → `subagent_ended`.

---

### 📊 Session Management

```typescript
const session  = sdk.createSession({ ... });          // Create
const resumed  = await sdk.resumeSession("sess-123"); // Resume
const forked   = await sdk.forkSession("sess-123", {  // Fork
  identity: { ... },
});
const sessions = await sdk.listSessions();             // List all
const history  = await sdk.readSessionHistory("id");   // Read transcript
await session.reset("context_overflow");               // Reset
const usage    = session.getUsageSnapshot();            // Token usage
```

**Context Compaction** — long conversations don't overflow:

```typescript
await session.maybeCompactByTokens({
  usedPctThreshold: 85,  // trigger at 85% context usage
  cooldownMs: 60_000,    // min 60s between compactions
});
```

**File Checkpoints** — every write creates an automatic rollback point:

```typescript
const checkpoints = await session.listCheckpoints();
await session.restoreCheckpoint(checkpoints[0].id);
```

<br/>

---

<!-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ -->

## 🏗 Architecture

<div align="center">
<br/>

<img src=".github/assets/architecture.svg" alt="Architecture" width="100%">

<br/><br/>
</div>

<details>
<summary><strong>📁 Repository structure</strong></summary>

```
general-agent-sdk/
├── src/
│   ├── index.ts                → Package entry point
│   ├── public/                 → Stable public API surface
│   │   ├── sdk.ts              → createGeneralAgentSdk()
│   │   ├── session.ts          → GeneralAgentSession
│   │   ├── events.ts           → GeneralAgentStreamEvent
│   │   ├── hooks.ts            → 26 hook type definitions
│   │   ├── types.ts            → Shared types
│   │   ├── host-tools.ts       → Hosted tool definitions
│   │   └── persistence.ts      → Storage adapter interface
│   ├── core/
│   │   ├── embedded-runner/    → Session factory + runtime
│   │   ├── compaction/         → Context window compaction
│   │   ├── mcp/                → MCP client (stdio + HTTP)
│   │   ├── model/              → Model context window resolution
│   │   ├── plugins/            → Hook runner engine
│   │   ├── sessions/           → Metadata index + transcript repair
│   │   └── checkpoints/        → File checkpoint manager
│   ├── tools/                  → Built-in tool implementations
│   ├── loop/                   → Agent execution loop
│   └── providers/              → LLM provider adapters
├── SDK DOCS/                   → Runnable examples + API reference
├── tests/                      → 133 tests (unit / integration / contract / e2e)
└── manifests/                  → Upstream provenance tracking
```

</details>

---

## 📋 Event Reference

| Event | Payload | Description |
|:------|:--------|:------------|
| `assistant_delta` | `{ text }` | Streaming text chunk from the model |
| `reasoning_delta` | `{ text }` | Extended thinking (chain-of-thought) |
| `reasoning_end` | — | Thinking phase complete |
| `tool_call` | `{ callId, toolName, input }` | Built-in tool invoked by the agent |
| `tool_result` | `{ callId, toolName, output }` | Tool execution result |
| `tool_error` | `{ callId, toolName, error }` | Tool execution failed |
| `hosted_tool_call` | `{ callId, toolName, input }` | **Your** tool requested — SDK suspends |
| `usage_snapshot` | `{ snapshot }` | Token usage update |
| `compaction_started` | `{ reason }` | Context compaction in progress |
| `compaction_finished` | `{ reason, tokensAfter? }` | Compaction complete |
| `turn_complete` | `{ stopReason }` | Turn finished |

---

## 🧰 Built-in Tools

| Tool | Description | Category |
|:-----|:------------|:---------|
| `read` | Read file contents with optional line ranges | File I/O |
| `write` | Create or overwrite files | File I/O |
| `edit` | Surgical string-replace edits | File I/O |
| `apply_patch` | Apply unified diff patches | File I/O |
| `exec` | Execute shell commands | System |
| `web_search` | Search the web (Brave / DuckDuckGo) | Web |
| `web_fetch` | Fetch and parse web pages | Web |
| `subagents` | Spawn scoped child agents | Orchestration |

---

## 📖 Examples

All examples are **runnable** TypeScript files:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
npx tsx "SDK DOCS/01-hello-world.ts"
```

| # | Example | What it covers |
|:--|:--------|:---------------|
| 01 | [`hello-world.ts`](./SDK%20DOCS/01-hello-world.ts) | Minimal agent, first `streamTurn()` call |
| 02 | [`multi-turn-chat.ts`](./SDK%20DOCS/02-multi-turn-chat.ts) | Interactive REPL with memory |
| 03 | [`hosted-tools.ts`](./SDK%20DOCS/03-hosted-tools.ts) | Custom tool with suspend/resume |
| 04 | [`session-lifecycle.ts`](./SDK%20DOCS/04-session-lifecycle.ts) | Create, resume, fork, reset |
| 05 | [`hooks.ts`](./SDK%20DOCS/05-hooks.ts) | Lifecycle hooks in action |
| 06 | [`mcp-servers.ts`](./SDK%20DOCS/06-mcp-servers.ts) | Dynamic MCP integration |
| 07 | [`compaction.ts`](./SDK%20DOCS/07-compaction.ts) | Context window management |
| 08 | [`subagents.ts`](./SDK%20DOCS/08-subagents.ts) | Child agent delegation |

> 📚 Full API documentation: [`SDK DOCS/API-REFERENCE.md`](./SDK%20DOCS/API-REFERENCE.md)

---

## 🔧 Development

```bash
pnpm install                            # Install dependencies
pnpm run check                          # Type check
pnpm run build                          # Build
pnpm run test                           # 133 unit + integration tests
pnpm run test:e2e                       # Package smoke test
node scripts/verify-upstream-snapshot.mjs  # Verify provenance
```

---

<div align="center">

<br/>

**MIT** · Built by [BabelCloud](https://github.com/babelcloud)

<br/>

<sub>If this project helps you build something cool, give it a ⭐ — it helps others find it too.</sub>

<br/><br/>

</div>
