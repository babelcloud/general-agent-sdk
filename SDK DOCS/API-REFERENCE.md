# General Agent SDK — API 参考

## 目录

- [工厂函数](#工厂函数)
- [SDK 接口](#sdk-接口)
- [Session 接口](#session-接口)
- [配置类型](#配置类型)
- [事件类型](#事件类型)
- [持久化适配器](#持久化适配器)
- [宿主工具 (Hosted Tools)](#宿主工具-hosted-tools)
- [Hook 系统](#hook-系统)
- [MCP 服务器](#mcp-服务器)

---

## 工厂函数

### `createGeneralAgentSdk(options)`

创建 SDK 实例。

```ts
import { createGeneralAgentSdk } from "general-agent-sdk";

const sdk = await createGeneralAgentSdk(options);
```

**参数：** `GeneralAgentSdkOptions`

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `workspaceDir` | `string` | ✅ | 工作区根目录 |
| `stateDir` | `string` | ✅ | SDK 状态存储目录 |
| `agentDir` | `string` | ✅ | Agent 配置目录 |
| `profileId` | `string` | ✅ | 用户 profile 标识 |
| `pluginMode` | `"disabled" \| "allowlisted" \| "full-embedded"` | ✅ | 插件模式 |
| `logger` | `GeneralAgentHostLogger` | ✅ | 日志适配器 |
| `sessionStore` | `GeneralAgentSessionStoreAdapter` | ✅ | 持久化适配器 |
| `hostedTools` | `GeneralAgentHostedToolDefinition[]` | ❌ | 宿主自定义工具 |
| `hooks` | `GeneralAgentHookRegistration[]` | ❌ | Hook 注册列表 |
| `anthropicApiKey` | `string` | ❌ | API Key（也可通过环境变量） |
| `enabledPluginIds` | `string[]` | ❌ | 允许的插件 ID 列表 |
| `env` | `Record<string, string>` | ❌ | 环境变量覆盖 |
| `tools` | `GeneralAgentSdkToolOptions` | ❌ | 内建工具配置 |

**返回：** `Promise<GeneralAgentSdk>`

---

## SDK 接口

### `GeneralAgentSdk`

```ts
interface GeneralAgentSdk {
  createSession(params: GeneralAgentSessionParams): GeneralAgentSession;
  continueSession(params: GeneralAgentContinueSessionParams): Promise<GeneralAgentSession>;
  resumeSession(sessionId: string, overrides?: GeneralAgentResumeSessionParams): Promise<GeneralAgentSession>;
  forkSession(sourceSessionId: string, params: GeneralAgentForkSessionParams): Promise<GeneralAgentSession>;
  listSessions(): Promise<GeneralAgentStoredSessionSummary[]>;
  readSessionHistory(sessionId: string): Promise<GeneralAgentTranscriptEntry[]>;
  emitHook<TName extends GeneralAgentHookName>(request: GeneralAgentHookDispatchRequest<TName>): Promise<GeneralAgentHookDispatchResult<TName> | undefined>;
  shutdown(): Promise<void>;
}
```

#### `sdk.createSession(params)`

创建新会话。

```ts
const session = sdk.createSession({
  identity: {
    mode: "general",       // "general" | "coding"
    sessionId: "uuid...",
    sessionKey: "host:default:general",
  },
  systemPrompt: "You are a helpful assistant.",
  modelRef: "claude-sonnet-4-20250514",
  sessionFile: "/path/to/transcript.jsonl",
  // 可选：
  anthropicApiKey: "sk-...",
  authProfileId: "enterprise-default",
  rawEventLogPath: "/path/to/raw-events.jsonl",
});
```

#### `sdk.resumeSession(sessionId, overrides?)`

恢复已持久化的会话（通过 sessionId 查找）。

```ts
const session = await sdk.resumeSession("sess-123");
```

#### `sdk.forkSession(sourceSessionId, params)`

从现有会话分叉出新会话（继承消息历史）。

```ts
const forked = await sdk.forkSession("sess-123", {
  identity: { mode: "general", sessionId: "fork-1", sessionKey: "host:default:fork-1" },
  sessionFile: "/path/to/fork.jsonl",
});
```

#### `sdk.listSessions()`

列举所有已存储的会话。

```ts
const sessions = await sdk.listSessions();
// [{ sessionId, sessionKey, mode, modelRef, systemPrompt, createdAtMs, updatedAtMs, ... }]
```

#### `sdk.readSessionHistory(sessionId)`

读取会话的 transcript 历史。

```ts
const entries = await sdk.readSessionHistory("sess-123");
// [{ type: "message" | "tool_call" | "tool_result" | "assistant" | "system_prompt", ... }]
```

#### `sdk.emitHook(request)`

主动触发 hook。

```ts
const result = await sdk.emitHook({
  hookName: "message_sending",
  event: { to: "channel:123", content: "hello" },
  context: { channelId: "discord" },
});
```

#### `sdk.shutdown()`

关闭 SDK，释放所有资源。

---

## Session 接口

### `GeneralAgentSession`

```ts
interface GeneralAgentSession {
  // 核心对话
  streamTurn(input: GeneralAgentTurnInput): AsyncIterable<GeneralAgentStreamEvent>;
  injectMessage(input: GeneralAgentTurnInput): boolean;
  
  // 宿主工具交互
  submitHostedToolResult(input: GeneralAgentHostedToolResultInput): AsyncIterable<GeneralAgentStreamEvent>;
  submitHostedToolError(input: GeneralAgentHostedToolErrorInput): AsyncIterable<GeneralAgentStreamEvent>;
  
  // 执行控制
  requestStop(): void;
  clearStop(): void;
  isStopRequested(): boolean;
  
  // 会话管理
  reset(reason?: string): Promise<void>;
  getSessionId(): string;
  getTranscriptPath(): string | null;
  closeInput(): void;
  
  // 上下文管理
  requestCompaction(): Promise<void>;
  maybeCompactByTokens(options?: GeneralAgentCompactionOptions): Promise<void>;
  getUsageSnapshot(): GeneralAgentUsageSnapshot | null;
  getCurrentQuery(): GeneralAgentCurrentQueryLike | null;
  
  // 文件检查点
  listCheckpoints(): Promise<GeneralAgentFileCheckpoint[]>;
  restoreCheckpoint(id: string): Promise<void>;
  
  // MCP 服务器
  setDynamicMcpServers(servers: Record<string, GeneralAgentMcpServerConfig>): void;
  getDynamicMcpServers(): Record<string, GeneralAgentMcpServerConfig>;
}
```

#### `session.streamTurn(input)`

发送消息并流式接收回复。这是最核心的 API。

```ts
for await (const event of session.streamTurn({
  role: "user",
  content: [
    { type: "text", text: "Hello!" },
    // 也支持图片：
    // { type: "image", mimeType: "image/png", data: base64String },
  ],
})) {
  if (event.kind === "assistant_delta") {
    process.stdout.write(event.text);
  }
}
```

**消息历史自动累积** — 每个 turn 的消息（用户 + 助手 + 工具结果）自动保存在会话内部，后续 turn 可以引用之前的对话内容。

#### `session.submitHostedToolResult(input)` / `session.submitHostedToolError(input)`

提交宿主工具执行结果，恢复 Agent 执行。

```ts
// 成功
for await (const event of session.submitHostedToolResult({
  callId: "call-123",
  output: { result: "success" },
})) { /* ... */ }

// 失败
for await (const event of session.submitHostedToolError({
  callId: "call-123",
  error: "Tool execution failed",
})) { /* ... */ }
```

#### `session.reset(reason?)`

重置会话——清除消息历史、用量状态、pending 状态，但保留会话身份和配置。

```ts
await session.reset("context_overflow");
```

触发 `before_reset` hook。

#### `session.requestCompaction()` / `session.maybeCompactByTokens(options?)`

手动或自动触发上下文压缩。

```ts
// 强制压缩
await session.requestCompaction();

// 条件压缩
await session.maybeCompactByTokens({
  usedPctThreshold: 85,  // 上下文使用率超过 85% 时触发
  cooldownMs: 60_000,    // 两次压缩间隔至少 60 秒
});
```

#### `session.getUsageSnapshot()`

获取当前 token 用量快照。

```ts
const usage = session.getUsageSnapshot();
// { usedInputTokens: 1234, contextWindow: 200000, usedPct: 0.6, capturedAtMs: ... }
```

#### `session.listCheckpoints()` / `session.restoreCheckpoint(id)`

文件检查点管理。文件写入工具自动创建检查点，支持回退。

```ts
const checkpoints = await session.listCheckpoints();
await session.restoreCheckpoint(checkpoints[0].id);
```

---

## 配置类型

### `GeneralAgentTurnInput`

```ts
interface GeneralAgentTurnInput {
  role: "user";
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; mimeType: string; data: string }
    | { type: "tool_result"; callId: string; output: unknown; isError?: boolean }
  >;
}
```

### `GeneralAgentSessionIdentity`

```ts
interface GeneralAgentSessionIdentity {
  mode: "general" | "coding";
  sessionId: string;
  sessionKey: string;
}
```

### `GeneralAgentUsageSnapshot`

```ts
interface GeneralAgentUsageSnapshot {
  usedInputTokens: number;
  contextWindow: number;
  usedPct: number;
  capturedAtMs: number;
}
```

### `GeneralAgentCompactionOptions`

```ts
interface GeneralAgentCompactionOptions {
  usedPctThreshold?: number;  // 默认 85
  cooldownMs?: number;        // 默认 60000
}
```

### `GeneralAgentHostLogger`

```ts
interface GeneralAgentHostLogger {
  onDebug(event: GeneralAgentLogEvent): void;
  onInfo(event: GeneralAgentLogEvent): void;
  onWarn(event: GeneralAgentLogEvent): void;
  onError(event: GeneralAgentLogEvent): void;
  onRawStreamEvent?(event: Record<string, unknown>): void;
}

interface GeneralAgentLogEvent {
  category: "system_prompt" | "tool_call" | "tool_result" | "assistant" | "system" | "provider_debug";
  message: string;
  data?: Record<string, unknown>;
}
```

---

## 事件类型

### `GeneralAgentStreamEvent`

```ts
type GeneralAgentStreamEvent =
  | { kind: "assistant_delta"; text: string }
  | { kind: "reasoning_delta"; text: string }
  | { kind: "reasoning_end" }
  | { kind: "tool_call"; callId: string; toolName: string; input: Record<string, unknown> }
  | { kind: "tool_result"; callId: string; toolName: string; output: unknown; details?: unknown; isError?: boolean }
  | { kind: "tool_error"; callId: string; toolName: string; error: string; details?: unknown }
  | { kind: "hosted_tool_call"; callId: string; toolName: string; input: Record<string, unknown> }
  | { kind: "usage_snapshot"; snapshot: GeneralAgentUsageSnapshot }
  | { kind: "compaction_started"; reason: string }
  | { kind: "compaction_finished"; reason: string; tokensAfter?: number }
  | { kind: "turn_complete"; stopReason: string };
```

---

## 持久化适配器

### `GeneralAgentSessionStoreAdapter`

```ts
interface GeneralAgentSessionStoreAdapter {
  load(identity: GeneralAgentSessionIdentity): Promise<GeneralAgentStoredSession | null>;
  save(identity: GeneralAgentSessionIdentity, value: GeneralAgentStoredSession): Promise<void>;
  resolveSessionFile(identity: GeneralAgentSessionIdentity): Promise<string>;
}
```

SDK 不拥有会话状态——宿主通过此适配器完全控制持久化策略。

**最简内存实现：**

```ts
const sessions = new Map<string, unknown>();
const sessionStore = {
  async load(identity) { return sessions.get(identity.sessionKey) ?? null; },
  async save(identity, value) { sessions.set(identity.sessionKey, value); },
  async resolveSessionFile(identity) {
    return path.join(os.tmpdir(), `${identity.sessionId}.jsonl`);
  },
};
```

**生产级文件实现：**

```ts
const sessionStore = {
  async load(identity) {
    try {
      const raw = await fs.readFile(`/data/sessions/${identity.sessionKey}.json`, "utf-8");
      return JSON.parse(raw);
    } catch { return null; }
  },
  async save(identity, value) {
    await fs.writeFile(`/data/sessions/${identity.sessionKey}.json`, JSON.stringify(value));
  },
  async resolveSessionFile(identity) {
    return `/data/transcripts/${identity.sessionId}.jsonl`;
  },
};
```

---

## 宿主工具 (Hosted Tools)

### `GeneralAgentHostedToolDefinition`

```ts
interface GeneralAgentHostedToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;  // JSON Schema
}
```

### 宿主工具交互模式

```
Agent 要调用工具 → SDK 发出 hosted_tool_call 事件 → SDK 自动挂起
           ↓
宿主执行工具逻辑（调用 API、查数据库等）
           ↓
宿主调用 submitHostedToolResult/Error → SDK 恢复 Agent 执行
           ↓
Agent 使用工具结果继续思考和回答
```

### 跨进程重启恢复

Hosted tool 挂起状态自动持久化。即使进程重启，SDK 也能从持久化状态恢复并继续执行。支持单工具和多工具并行挂起。

---

## Hook 系统

### Hook 注册

```ts
const hooks: GeneralAgentHookRegistration[] = [
  {
    pluginId: "my-plugin",       // 插件标识
    priority: 100,               // 优先级（可选，默认 0）
    hookName: "before_tool_call",
    handler: async (event, ctx) => {
      // event: hook 事件数据
      // ctx: hook 上下文（sessionId, agentId 等）
      return { block: true, blockReason: "Denied" };  // 可选返回值
    },
  },
];
```

### Hook 完整列表

| Hook Name | 触发方式 | 可返回值 | 说明 |
|-----------|----------|----------|------|
| `before_model_resolve` | SDK | `{ modelOverride?, providerOverride? }` | 动态切换模型 |
| `before_prompt_build` | SDK | `{ systemPrompt?, prependContext?, appendSystemContext? }` | 修改 prompt |
| `before_agent_start` | SDK | 同上 + model | Agent 启动前 |
| `llm_input` | SDK | void | 观察 LLM 请求 |
| `llm_output` | SDK | void | 观察 LLM 响应 |
| `agent_end` | SDK | void | Agent 执行结束 |
| `before_tool_call` | SDK | `{ block?, blockReason?, params? }` | 拦截/修改工具调用 |
| `after_tool_call` | SDK | void | 工具调用完成后 |
| `tool_result_persist` | SDK | `{ message? }` | 工具结果持久化 |
| `before_message_write` | SDK | `{ block?, message? }` | 消息写入前 |
| `session_start` | SDK | void | 会话首次使用 |
| `session_end` | SDK | void | 会话结束 |
| `before_compaction` | SDK | void | 上下文压缩前 |
| `after_compaction` | SDK | void | 上下文压缩后 |
| `before_reset` | SDK | void | 会话重置前 |
| `subagent_spawning` | SDK | `{ status: "ok" } \| { status: "error", error }` | 子代理创建前 |
| `subagent_delivery_target` | SDK | `{ origin? }` | 子代理交付 |
| `subagent_spawned` | SDK | void | 子代理已创建 |
| `subagent_ended` | SDK | void | 子代理结束 |
| `inbound_claim` | 宿主 | `{ handled }` | 入站消息认领 |
| `before_dispatch` | 宿主 | `{ handled, text? }` | 消息分发前 |
| `message_received` | 宿主 | void | 消息接收 |
| `message_sending` | 宿主 | `{ content?, cancel? }` | 消息发送前 |
| `message_sent` | 宿主 | void | 消息发送后 |
| `gateway_start` | 宿主 | void | 网关启动 |
| `gateway_stop` | 宿主 | void | 网关关闭 |

---

## MCP 服务器

### `GeneralAgentMcpServerConfig`

```ts
// stdio 模式
interface GeneralAgentMcpStdioServerConfig {
  transport: "stdio";
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

// http 模式
interface GeneralAgentMcpHttpServerConfig {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

type GeneralAgentMcpServerConfig =
  | GeneralAgentMcpStdioServerConfig
  | GeneralAgentMcpHttpServerConfig;
```

### MCP 服务器状态

```ts
interface GeneralAgentMcpServerStatus {
  serverName: string;
  transport: "stdio" | "http";
  enabled: boolean;
  supported: boolean;
  error?: string;
}
```

---

## 工具配置

### Web 工具配置

```ts
interface GeneralAgentSdkToolOptions {
  web?: {
    fetch?: {
      cacheTtlMinutes?: number;
      timeoutSeconds?: number;
      maxCharsCap?: number;
      maxResponseBytes?: number;
      maxRedirects?: number;
      userAgent?: string;
      readability?: boolean;
      firecrawl?: {
        enabled?: boolean;
        apiKey?: string;
        baseUrl?: string;
        onlyMainContent?: boolean;
        maxAgeMs?: number;
        timeoutSeconds?: number;
      };
    };
    search?: {
      apiKey?: string;  // Brave Search API Key
    };
  };
}
```

`web_search` 默认使用 DuckDuckGo（无需 API Key）。配置 Brave Search API Key 后自动切换到 Brave。

---

## API Key 解析顺序

1. `session.params.anthropicApiKey` — Session 级别显式传入
2. `sdk.options.anthropicApiKey` — SDK 级别显式传入
3. `process.env.ANTHROPIC_API_KEY` — 环境变量
4. 如果都没有 → 抛出 `Error("No API key provided...")`

Base URL 解析：
1. 显式传入的 `baseUrl` 参数
2. `process.env.ANTHROPIC_BASE_URL`
3. 默认 `https://api.anthropic.com`
