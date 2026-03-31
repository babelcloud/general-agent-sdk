# General Agent SDK — 开发者文档

本目录包含 `general-agent-sdk` 的完整开发者文档和使用示例。

## 前置条件

```bash
npm install general-agent-sdk
# 或
pnpm add general-agent-sdk
```

Node.js >= 22.14.0，纯 ESM 项目。

## API Key 配置

SDK 按以下优先级读取 Anthropic API Key：

1. **显式传参** — `createGeneralAgentSdk({ anthropicApiKey: "..." })` 或 `createSession({ anthropicApiKey: "..." })`
2. **环境变量** — `process.env.ANTHROPIC_API_KEY`

自定义 Base URL（如代理服务）通过环境变量设置：

```bash
export ANTHROPIC_API_KEY="your-key"
export ANTHROPIC_BASE_URL="https://your-proxy.example.com/api/anthropic"
```

> ⚠️ Base URL 不要带 `/v1` — Anthropic SDK 内部会自动拼上 `/v1/messages`

## 示例列表

| 文件 | 说明 |
|------|------|
| [`01-hello-world.ts`](./01-hello-world.ts) | 最简单的 Hello World：初始化 SDK → 创建会话 → 流式对话 |
| [`02-multi-turn-chat.ts`](./02-multi-turn-chat.ts) | 多轮对话：在同一会话中进行连续对话，记忆跨 turn |
| [`03-hosted-tools.ts`](./03-hosted-tools.ts) | 宿主工具：注册自定义工具 → 挂起 → 宿主执行 → 恢复 |
| [`04-session-lifecycle.ts`](./04-session-lifecycle.ts) | 会话生命周期：列举、恢复、分叉、重置会话 |
| [`05-hooks.ts`](./05-hooks.ts) | Hook 系统：在 Agent 生命周期中注入自定义行为 |
| [`06-mcp-servers.ts`](./06-mcp-servers.ts) | MCP 服务器：动态注册 stdio / http 工具服务器 |
| [`07-compaction.ts`](./07-compaction.ts) | 上下文压缩：长对话中自动压缩上下文窗口 |
| [`08-subagents.ts`](./08-subagents.ts) | 子代理：模型自主创建子会话，执行独立子任务 |

## 核心概念

### SDK 架构

```
Host App
 └─ createGeneralAgentSdk(options)  → GeneralAgentSdk
     ├─ sdk.createSession(params)    → GeneralAgentSession
     │   ├─ session.streamTurn(input)    → AsyncIterable<StreamEvent>
     │   ├─ session.submitHostedToolResult(...)
     │   ├─ session.reset(...)
     │   └─ session.maybeCompactByTokens(...)
     ├─ sdk.resumeSession(id)
     ├─ sdk.forkSession(sourceId, params)
     ├─ sdk.listSessions()
     ├─ sdk.emitHook(request)
     └─ sdk.shutdown()
```

### 事件模型

SDK 通过 `streamTurn()` 返回的 `AsyncIterable<GeneralAgentStreamEvent>` 发送以下事件：

| 事件 Kind | 说明 |
|-----------|------|
| `assistant_delta` | 流式文本增量 |
| `reasoning_delta` | 思考过程增量（extended thinking 模型） |
| `reasoning_end` | 思考结束 |
| `tool_call` | SDK 内建工具调用 |
| `tool_result` | 工具执行结果 |
| `tool_error` | 工具执行错误 |
| `hosted_tool_call` | 宿主工具调用（SDK 挂起，等待宿主执行） |
| `usage_snapshot` | Token 用量快照 |
| `compaction_started` | 上下文压缩开始 |
| `compaction_finished` | 上下文压缩完成 |
| `turn_complete` | 本轮对话结束 |

### 内建工具

SDK 默认提供以下工具：

| 工具名 | 说明 |
|--------|------|
| `read` | 读取文件内容 |
| `write` | 写入文件 |
| `edit` | 编辑文件（基于 diff） |
| `apply_patch` | 应用代码补丁 |
| `exec` | 执行 Shell 命令 |
| `web_search` | 搜索网页 |
| `web_fetch` | 获取网页内容 |
| `subagents` | 创建子代理执行子任务 |

### SDK / 宿主边界

**SDK 负责：** 会话管理、工具执行、流式事件、上下文压缩、MCP 集成、Hook 生命周期
**宿主负责：** 目录路径、API Key、会话元数据、通道路由、环境变量、MCP 服务器注册

## 运行示例

```bash
# 设置 API Key
export ANTHROPIC_API_KEY="your-key"

# 可选：设置自定义 Base URL
export ANTHROPIC_BASE_URL="https://your-proxy.example.com/api/anthropic"

# 运行示例
npx tsx "SDK DOCS/01-hello-world.ts"
```

## API 速查

详见 [`API-REFERENCE.md`](./API-REFERENCE.md)。
