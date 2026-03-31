<div align="center">

# General Agent SDK

### Build AI agents that actually *do things*.

**Stream responses. Call tools. Manage sessions. Ship to production.**

[![npm version](https://img.shields.io/npm/v/general-agent-sdk?style=flat-square&color=cb3837&label=npm)](https://www.npmjs.com/package/general-agent-sdk)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.14-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-133%20passing-brightgreen?style=flat-square)](./tests)

<br/>

```
npm install general-agent-sdk
```

<br/>

[Quick Start](#-quick-start) · [Examples](./SDK%20DOCS/) · [API Reference](./SDK%20DOCS/API-REFERENCE.md) · [Documentation](#-documentation)

</div>

---

## Why General Agent SDK?

Most "agent frameworks" give you wrappers around chat completions. **General Agent SDK gives you a full execution kernel** — the agent runs tools autonomously, suspends for human input, resumes across restarts, and streams every event back to your app in real time.

```
┌─────────────────────────────────────────────────────────┐
│  Your App (Host)                                        │
│                                                         │
│   ┌──────────────────────────────────────────────────┐  │
│   │  General Agent SDK                               │  │
│   │                                                  │  │
│   │   User ──→ LLM ──→ Tool ──→ LLM ──→ Tool ──→ ✅ │  │
│   │              │        ↑        │        ↑        │  │
│   │              │   built-in      │   hosted tool   │  │
│   │              │   (read, exec,  │   (your code)   │  │
│   │              │    web_search)  │                  │  │
│   │              │                 │                  │  │
│   │              └── stream events back to host ──→  │  │
│   └──────────────────────────────────────────────────┘  │
│                                                         │
│   You control: credentials, persistence, tools, hooks   │
└─────────────────────────────────────────────────────────┘
```

<table>
<tr>
<td width="50%">

### What it does

- **Autonomous tool loops** — agent calls tools and continues thinking until done
- **8 built-in tools** — `read`, `write`, `edit`, `exec`, `web_search`, `web_fetch`, `apply_patch`, `subagents`
- **Hosted tools** — define your own tools, SDK suspends & resumes
- **Multi-turn memory** — sessions remember across turns automatically
- **Real-time streaming** — every token, tool call, and result as events
- **MCP integration** — plug in any MCP server (stdio or HTTP)
- **26 lifecycle hooks** — intercept anything from model selection to tool execution
- **Subagent delegation** — spawn child agents with scoped instructions

</td>
<td width="50%">

### What makes it different

- **Not a wrapper** — it's a complete agent execution engine
- **Host-owned** — you control persistence, credentials, and policy
- **Restart-safe** — hosted tool pauses survive process restarts
- **Production-ready** — context compaction, file checkpoints, error boundaries
- **Type-safe** — full TypeScript with zero `any` in public API
- **Tested** — 133 tests + real API E2E verification
- **Lightweight** — ~180KB packaged, 6 dependencies
- **Escape hatch friendly** — use as much or as little as you need

</td>
</tr>
</table>

---

## ⚡ Quick Start

### 1. Install

```bash
npm install general-agent-sdk
```

### 2. Set your API key

```bash
export ANTHROPIC_API_KEY="sk-ant-..."

# Optional: use a proxy
# export ANTHROPIC_BASE_URL="https://your-proxy.example.com"
```

### 3. Build your first agent

```typescript
import { createGeneralAgentSdk } from "general-agent-sdk";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";

// Initialize the SDK
const sdk = await createGeneralAgentSdk({
  workspaceDir: process.cwd(),
  stateDir: path.join(process.cwd(), ".agent-state"),
  agentDir: path.join(process.cwd(), ".agent"),
  profileId: "default",
  pluginMode: "disabled",
  logger: {
    onDebug() {}, onInfo() {}, onWarn() {}, onError() {},
  },
  sessionStore: {
    async load() { return null; },
    async save() {},
    async resolveSessionFile(id) {
      return path.join(os.tmpdir(), `${id.sessionId}.jsonl`);
    },
  },
});

// Create a session
const session = sdk.createSession({
  identity: { mode: "general", sessionId: randomUUID(), sessionKey: "my-app:default" },
  systemPrompt: "You are a helpful assistant.",
  modelRef: "claude-sonnet-4-20250514",
  sessionFile: path.join(os.tmpdir(), "session.jsonl"),
});

// Stream a conversation
for await (const event of session.streamTurn({
  role: "user",
  content: [{ type: "text", text: "What files are in the current directory?" }],
})) {
  switch (event.kind) {
    case "assistant_delta":
      process.stdout.write(event.text);
      break;
    case "tool_call":
      console.log(`\n🔧 ${event.toolName}(${JSON.stringify(event.input)})`);
      break;
    case "tool_result":
      console.log(`✅ Done`);
      break;
    case "turn_complete":
      console.log(`\n\n✅ Finished (${event.stopReason})`);
      break;
  }
}

await sdk.shutdown();
```

**That's it.** The agent will autonomously read the directory, think about the results, and give you a formatted answer — all streamed in real time.

---

## 🎯 Core Concepts

### The Event Stream

Every interaction returns an `AsyncIterable<GeneralAgentStreamEvent>`. No callbacks, no observers — just a `for await` loop:

```typescript
for await (const event of session.streamTurn(input)) {
  // event.kind tells you what happened:
  //
  //   "assistant_delta"    → streaming text chunk
  //   "reasoning_delta"    → model thinking (extended thinking)
  //   "tool_call"          → agent is calling a built-in tool
  //   "tool_result"        → tool returned a result
  //   "hosted_tool_call"   → YOUR tool was requested (SDK suspends)
  //   "usage_snapshot"     → token usage update
  //   "turn_complete"      → this turn is done
}
```

### Hosted Tools — Your Code, Their Brain

Define tools that the AI can call. **You implement the logic**, the SDK handles the orchestration:

```typescript
const sdk = await createGeneralAgentSdk({
  // ... other options ...
  hostedTools: [
    {
      name: "get_stock_price",
      description: "Get real-time stock price",
      inputSchema: {
        type: "object",
        properties: { symbol: { type: "string" } },
        required: ["symbol"],
      },
    },
  ],
});

// Handle tool calls
for await (const event of session.streamTurn(userMessage)) {
  if (event.kind === "hosted_tool_call") {
    // SDK automatically suspends here ⏸️

    // You execute your logic
    const price = await fetchStockPrice(event.input.symbol);

    // Resume the agent with the result ▶️
    for await (const resumed of session.submitHostedToolResult({
      callId: event.callId,
      output: { price, currency: "USD" },
    })) {
      if (resumed.kind === "assistant_delta") process.stdout.write(resumed.text);
    }
    break;
  }
}
```

### Multi-Turn Sessions

Sessions automatically maintain conversation history. The agent remembers everything:

```typescript
// Turn 1
await consume(session.streamTurn({
  role: "user",
  content: [{ type: "text", text: "My name is Alice and I like TypeScript." }],
}));

// Turn 2 — the agent remembers!
await consume(session.streamTurn({
  role: "user",
  content: [{ type: "text", text: "What's my name and what do I like?" }],
}));
// → "Your name is Alice and you like TypeScript."
```

### Hooks — Intercept Everything

26 hooks let you observe, modify, or block any part of the agent lifecycle:

```typescript
const sdk = await createGeneralAgentSdk({
  // ...
  hooks: [
    // Dynamically switch models
    {
      pluginId: "my-app",
      hookName: "before_model_resolve",
      handler: (event) => ({
        modelOverride: isComplexTask(event.prompt)
          ? "claude-opus-4-20250514"
          : "claude-sonnet-4-20250514",
      }),
    },
    // Block dangerous tool calls
    {
      pluginId: "my-app",
      hookName: "before_tool_call",
      handler: (event) => {
        if (event.toolName === "exec" && event.params.command?.includes("rm -rf")) {
          return { block: true, blockReason: "Dangerous command blocked" };
        }
      },
    },
    // Audit all LLM calls
    {
      pluginId: "my-app",
      hookName: "llm_output",
      handler: (event) => {
        console.log(`[audit] ${event.model}: ${event.usage?.input}in/${event.usage?.output}out tokens`);
      },
    },
  ],
});
```

---

## 🧰 Built-in Tools

The agent comes pre-loaded with powerful tools:

| Tool | What it does |
|------|-------------|
| `read` | Read file contents (with line ranges) |
| `write` | Create or overwrite files |
| `edit` | Surgical file edits with diff |
| `apply_patch` | Apply unified diffs |
| `exec` | Run shell commands |
| `web_search` | Search the web (DuckDuckGo / Brave) |
| `web_fetch` | Fetch and parse web pages |
| `subagents` | Delegate tasks to child agents |

The agent decides which tools to use. You can restrict available tools per session, and every tool call flows through the `before_tool_call` / `after_tool_call` hooks.

---

## 🔌 MCP Integration

Plug in any [Model Context Protocol](https://modelcontextprotocol.io/) server:

```typescript
// Local process
session.setDynamicMcpServers({
  filesystem: {
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/data"],
  },
});

// Remote HTTP endpoint
session.setDynamicMcpServers({
  my_api: {
    transport: "http",
    url: "https://mcp.example.com/api",
    headers: { Authorization: "Bearer token" },
  },
});
```

MCP tools show up alongside built-in tools. The agent uses them seamlessly.

---

## 🤖 Subagents

The agent can spawn child agents to divide and conquer:

```typescript
const session = sdk.createSession({
  // ...
  systemPrompt: `You are a project manager.
    Use the subagents tool to delegate tasks to specialists.`,
});

// The agent will autonomously:
// 1. Break the task into subtasks
// 2. Spawn child agents with scoped instructions
// 3. Collect results
// 4. Synthesize a final answer
```

Each subagent gets its own independent message history and scoped tool access. The `subagents` tool is excluded from children to prevent infinite recursion.

---

## 📊 Session Management

```typescript
// Create
const session = sdk.createSession({ ... });

// Resume by ID
const resumed = await sdk.resumeSession("session-123");

// Fork (branch from existing conversation)
const forked = await sdk.forkSession("session-123", { ... });

// List all sessions
const sessions = await sdk.listSessions();

// Read transcript history
const history = await sdk.readSessionHistory("session-123");

// Reset (clear history, keep config)
await session.reset("starting_fresh");

// Check token usage
const usage = session.getUsageSnapshot();
// → { usedInputTokens: 1234, contextWindow: 200000, usedPct: 0.6 }
```

### Context Compaction

Long conversations don't overflow — the SDK compacts automatically:

```typescript
await session.maybeCompactByTokens({
  usedPctThreshold: 85,  // trigger at 85% usage
  cooldownMs: 60_000,    // min 60s between compactions
});
```

### File Checkpoints

Every file write creates an automatic checkpoint. Roll back anytime:

```typescript
const checkpoints = await session.listCheckpoints();
await session.restoreCheckpoint(checkpoints[0].id);
```

---

## 📖 Documentation

| Resource | Description |
|----------|-------------|
| [`SDK DOCS/README.md`](./SDK%20DOCS/README.md) | Full documentation index |
| [`SDK DOCS/API-REFERENCE.md`](./SDK%20DOCS/API-REFERENCE.md) | Complete API reference |
| [`SDK DOCS/01-hello-world.ts`](./SDK%20DOCS/01-hello-world.ts) | Your first agent |
| [`SDK DOCS/02-multi-turn-chat.ts`](./SDK%20DOCS/02-multi-turn-chat.ts) | Interactive multi-turn REPL |
| [`SDK DOCS/03-hosted-tools.ts`](./SDK%20DOCS/03-hosted-tools.ts) | Custom tool integration |
| [`SDK DOCS/04-session-lifecycle.ts`](./SDK%20DOCS/04-session-lifecycle.ts) | Session management |
| [`SDK DOCS/05-hooks.ts`](./SDK%20DOCS/05-hooks.ts) | Lifecycle hooks |
| [`SDK DOCS/06-mcp-servers.ts`](./SDK%20DOCS/06-mcp-servers.ts) | MCP server integration |
| [`SDK DOCS/07-compaction.ts`](./SDK%20DOCS/07-compaction.ts) | Context window management |
| [`SDK DOCS/08-subagents.ts`](./SDK%20DOCS/08-subagents.ts) | Subagent delegation |

All examples are **runnable** — just set your API key and go:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
npx tsx "SDK DOCS/01-hello-world.ts"
```

---

## 🏗️ Architecture

```
general-agent-sdk/
├── src/
│   ├── index.ts              → Package entry point
│   ├── public/               → Stable public API types
│   │   ├── sdk.ts            → createGeneralAgentSdk()
│   │   ├── session.ts        → GeneralAgentSession interface
│   │   ├── events.ts         → Stream event types
│   │   ├── hooks.ts          → 26 hook definitions
│   │   ├── types.ts          → Shared types
│   │   ├── host-tools.ts     → Hosted tool types
│   │   └── persistence.ts    → Storage adapter
│   ├── core/                 → Runtime implementation
│   │   ├── embedded-runner/  → Session + factory
│   │   ├── compaction/       → Context compaction
│   │   ├── mcp/              → MCP client (stdio + http)
│   │   ├── model/            → Model context windows
│   │   ├── plugins/          → Hook runner
│   │   ├── sessions/         → Metadata + transcript repair
│   │   └── checkpoints/      → File checkpoint manager
│   ├── tools/                → Built-in tool implementations
│   ├── loop/                 → Agent execution loop
│   └── providers/            → LLM provider adapters
├── SDK DOCS/                 → Examples + API reference
├── tests/                    → 133 tests (unit/integration/contract/e2e)
└── manifests/                → Upstream provenance tracking
```

---

## 🔧 Development

```bash
# Install
pnpm install

# Type check
pnpm run check

# Build
pnpm run build

# Run tests
pnpm run test          # 133 unit + integration tests
pnpm run test:e2e      # package smoke test

# Verify upstream provenance
node scripts/verify-upstream-snapshot.mjs
```

---

## 📋 Event Reference

| Event | Payload | When |
|-------|---------|------|
| `assistant_delta` | `{ text }` | Each streaming text chunk |
| `reasoning_delta` | `{ text }` | Model thinking (extended thinking) |
| `reasoning_end` | — | Thinking complete |
| `tool_call` | `{ callId, toolName, input }` | Built-in tool invoked |
| `tool_result` | `{ callId, toolName, output }` | Tool returned result |
| `tool_error` | `{ callId, toolName, error }` | Tool failed |
| `hosted_tool_call` | `{ callId, toolName, input }` | Your tool requested (SDK suspends) |
| `usage_snapshot` | `{ snapshot }` | Token usage update |
| `compaction_started` | `{ reason }` | Context compaction begins |
| `compaction_finished` | `{ reason, tokensAfter? }` | Compaction complete |
| `turn_complete` | `{ stopReason }` | Turn finished |

---

## 🪝 Hook Reference

<details>
<summary><strong>19 SDK-native hooks</strong> (auto-fired by runtime)</summary>

| Hook | Can modify? | Description |
|------|:-----------:|-------------|
| `before_model_resolve` | ✅ | Override model selection |
| `before_prompt_build` | ✅ | Inject context into prompts |
| `before_agent_start` | ✅ | Final pre-run modifications |
| `llm_input` | — | Observe LLM request |
| `llm_output` | — | Observe LLM response + usage |
| `agent_end` | — | Run completed |
| `before_tool_call` | ✅ | Modify args or block execution |
| `after_tool_call` | — | Observe tool result |
| `tool_result_persist` | ✅ | Modify persisted tool result |
| `before_message_write` | ✅ | Modify or block transcript writes |
| `session_start` | — | Session first used |
| `session_end` | — | Session done |
| `before_compaction` | — | Compaction starting |
| `after_compaction` | — | Compaction finished |
| `before_reset` | — | Session about to reset |
| `subagent_spawning` | ✅ | Block subagent creation |
| `subagent_delivery_target` | ✅ | Override delivery routing |
| `subagent_spawned` | — | Child agent created |
| `subagent_ended` | — | Child agent finished |

</details>

<details>
<summary><strong>7 Host-bridged hooks</strong> (triggered via <code>sdk.emitHook()</code>)</summary>

| Hook | Description |
|------|-------------|
| `inbound_claim` | Incoming message routing |
| `before_dispatch` | Pre-dispatch filtering |
| `message_received` | Message received |
| `message_sending` | Modify/cancel outgoing messages |
| `message_sent` | Message delivery confirmation |
| `gateway_start` | Gateway lifecycle |
| `gateway_stop` | Gateway shutdown |

</details>

---

## License

[MIT](./LICENSE) — built by [BabelCloud](https://github.com/babelcloud)
