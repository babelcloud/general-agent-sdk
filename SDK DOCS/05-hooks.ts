/**
 * 05-hooks.ts
 *
 * Hook 系统示例：
 *  - 注册 hook 拦截和观察 Agent 生命周期事件
 *  - SDK 自动在正确时机触发所有 19 种 SDK-native hooks
 *  - 宿主也可通过 sdk.emitHook() 主动触发 host-bridged hooks
 *
 * Hook 是 SDK 最强大的扩展机制——你可以用它来：
 *  - 动态切换模型 (before_model_resolve)
 *  - 修改 system prompt (before_prompt_build / before_agent_start)
 *  - 审计每个工具调用 (before_tool_call / after_tool_call)
 *  - 阻止特定工具执行 (before_tool_call → { block: true })
 *  - 观察 LLM 输入/输出 (llm_input / llm_output)
 *  - 管理子代理生命周期 (subagent_spawning → { status: "error" } 可阻止创建)
 *
 * 运行: ANTHROPIC_API_KEY=sk-... npx tsx "SDK DOCS/05-hooks.ts"
 */
import { createGeneralAgentSdk } from "general-agent-sdk";
import type {
  GeneralAgentHookRegistration,
  GeneralAgentStreamEvent,
} from "general-agent-sdk";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";

// ─── 1. 定义 Hook ──────────────────────────────────────────

const hooks: GeneralAgentHookRegistration[] = [
  // ── 观察 LLM 输入 ──
  // 每次发送给模型的请求都会触发这个 hook
  {
    pluginId: "demo",
    hookName: "llm_input",
    handler: (event) => {
      console.log(`\n  🔍 [llm_input] 模型: ${event.provider}/${event.model}`);
      console.log(`     Prompt: "${event.prompt.slice(0, 80)}..."`);
      console.log(`     历史消息数: ${event.historyMessages.length}`);
    },
  },

  // ── 观察 LLM 输出 ──
  // 模型返回完整响应后触发
  {
    pluginId: "demo",
    hookName: "llm_output",
    handler: (event) => {
      const inputTokens = event.usage?.input ?? 0;
      const outputTokens = event.usage?.output ?? 0;
      console.log(`  📊 [llm_output] Input: ${inputTokens}, Output: ${outputTokens} tokens`);
    },
  },

  // ── 修改 System Prompt ──
  // 可以在每次 Agent 启动前动态注入上下文
  {
    pluginId: "demo",
    hookName: "before_prompt_build",
    handler: (event) => {
      console.log(`  📝 [before_prompt_build] 注入自定义上下文`);
      return {
        // 在 system prompt 末尾追加内容
        appendSystemContext: "\n\nAlways end your response with a fun emoji.",
        // 在用户消息前追加上下文
        prependContext: "[User timezone: Asia/Shanghai]",
      };
    },
  },

  // ── 工具调用审计 ──
  // 每个工具调用前后都会触发
  {
    pluginId: "demo",
    hookName: "before_tool_call",
    handler: (event) => {
      console.log(`  🔧 [before_tool_call] ${event.toolName}(${JSON.stringify(event.params).slice(0, 100)})`);
      // 返回 { block: true, blockReason: "..." } 可以阻止工具执行
      return undefined;
    },
  },
  {
    pluginId: "demo",
    hookName: "after_tool_call",
    handler: (event) => {
      const status = event.error ? `❌ ${event.error}` : "✅ OK";
      console.log(`  🔧 [after_tool_call] ${event.toolName} → ${status} (${event.durationMs}ms)`);
    },
  },

  // ── 会话生命周期 ──
  {
    pluginId: "demo",
    hookName: "session_start",
    handler: (event) => {
      console.log(`  🚀 [session_start] Session: ${event.sessionId}`);
    },
  },
  {
    pluginId: "demo",
    hookName: "agent_end",
    handler: (event) => {
      console.log(`  🏁 [agent_end] 成功: ${event.success}, 消息数: ${event.messages.length}`);
    },
  },
];

// ─── 2. 初始化带 Hook 的 SDK ────────────────────────────────

const workDir = process.cwd();
const sdk = await createGeneralAgentSdk({
  workspaceDir: workDir,
  stateDir: path.join(workDir, ".general-agent-state"),
  agentDir: path.join(workDir, ".general-agent-agent"),
  profileId: "default",
  pluginMode: "disabled",
  logger: {
    onDebug() {},
    onInfo() {},
    onWarn({ message }) { console.warn(`⚠️  ${message}`); },
    onError({ message }) { console.error(`❌ ${message}`); },
  },
  sessionStore: {
    async load() { return null; },
    async save() {},
    async resolveSessionFile(id) {
      return path.join(os.tmpdir(), `general-agent-${id.sessionId}.jsonl`);
    },
  },
  hooks,  // ← 注册 hooks
});

// ─── 3. 创建会话并对话 ─────────────────────────────────────

const sessionId = randomUUID();
const session = sdk.createSession({
  identity: { mode: "general", sessionId, sessionKey: `hooks:${sessionId}` },
  systemPrompt: "You are a helpful assistant.",
  modelRef: "claude-sonnet-4-20250514",
  sessionFile: path.join(os.tmpdir(), `general-agent-${sessionId}.jsonl`),
});

console.log("💬 发送消息（观察 Hook 触发）...\n");

let response = "";
for await (const event of session.streamTurn({
  role: "user",
  content: [{ type: "text", text: "What is 2+2? Answer briefly." }],
})) {
  if (event.kind === "assistant_delta") {
    response += event.text;
  }
}

console.log(`\n📨 完整回复: "${response}"`);

// ─── 4. 主动触发 Host-bridged Hook ─────────────────────────
// 宿主可以主动触发某些 hook，用于通道层集成

console.log("\n── 主动触发 Host-bridged Hook ──");

// 示例：触发 message_sending hook（宿主准备发送消息时）
// 这类 hook 不由 SDK 自动触发，而是由宿主在需要时调用
await sdk.emitHook({
  hookName: "message_sending",
  event: {
    to: "channel:user-123",
    content: response,
  },
  context: {
    channelId: "web-chat",
  },
});

console.log("  ✅ message_sending hook 已触发");

await sdk.shutdown();
console.log("\n🏁 Done.");

/*
 * ─── 完整 Hook 列表 ──────────────────────────────────────
 *
 * SDK-native hooks（自动触发）：
 *   before_model_resolve  — 选择模型前
 *   before_prompt_build   — 构建 prompt 前
 *   before_agent_start    — Agent 启动前
 *   llm_input             — 发送给 LLM 前
 *   llm_output            — LLM 返回后
 *   agent_end             — Agent 运行结束
 *   before_tool_call      — 工具调用前（可阻止）
 *   after_tool_call       — 工具调用后
 *   tool_result_persist   — 工具结果持久化时
 *   before_message_write  — 消息写入 transcript 前
 *   session_start         — 会话首次使用时
 *   session_end           — 会话结束时
 *   before_compaction     — 上下文压缩前
 *   after_compaction      — 上下文压缩后
 *   before_reset          — 会话重置前
 *   subagent_spawning     — 子代理创建前（可阻止）
 *   subagent_delivery_target — 子代理交付目标确定
 *   subagent_spawned      — 子代理已创建
 *   subagent_ended        — 子代理结束
 *
 * Host-bridged hooks（需宿主主动触发）：
 *   inbound_claim         — 入站消息认领
 *   before_dispatch       — 分发前
 *   message_received      — 消息接收
 *   message_sending       — 消息发送前（可修改/取消）
 *   message_sent          — 消息发送后
 *   gateway_start         — 网关启动
 *   gateway_stop          — 网关关闭
 */
