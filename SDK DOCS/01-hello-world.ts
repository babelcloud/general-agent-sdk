/**
 * 01-hello-world.ts
 *
 * 最简示例：初始化 SDK → 创建会话 → 发送一条消息 → 流式打印回复
 *
 * 运行:
 *   ANTHROPIC_API_KEY=sk-... npx tsx "SDK DOCS/01-hello-world.ts"
 *
 * 如果使用代理服务（如 gru.ai），还需设置 Base URL：
 *   ANTHROPIC_BASE_URL=https://gru.ai/api/ai-proxy/anthropic
 */
import { createGeneralAgentSdk } from "general-agent-sdk";
import type {
  GeneralAgentHostLogger,
  GeneralAgentSessionStoreAdapter,
  GeneralAgentStreamEvent,
} from "general-agent-sdk";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";

// ─── 1. 实现最简日志适配器 ────────────────────────────────────
// SDK 不做任何日志输出——由宿主决定怎么记录
const logger: GeneralAgentHostLogger = {
  onDebug({ message }) {
    // 开发时可打开: console.debug(`[debug] ${message}`);
  },
  onInfo({ category, message }) {
    console.log(`ℹ️  [${category}] ${message}`);
  },
  onWarn({ message }) {
    console.warn(`⚠️  ${message}`);
  },
  onError({ message }) {
    console.error(`❌ ${message}`);
  },
};

// ─── 2. 实现最简持久化适配器 ──────────────────────────────────
// 本示例使用内存存储；生产环境中你应该持久化到文件或数据库
const sessions = new Map<string, unknown>();

const sessionStore: GeneralAgentSessionStoreAdapter = {
  async load(identity) {
    return (sessions.get(identity.sessionKey) as any) ?? null;
  },
  async save(identity, value) {
    sessions.set(identity.sessionKey, value);
  },
  async resolveSessionFile(identity) {
    return path.join(os.tmpdir(), `general-agent-${identity.sessionId}.jsonl`);
  },
};

// ─── 3. 初始化 SDK ───────────────────────────────────────────
const workDir = process.cwd();

const sdk = await createGeneralAgentSdk({
  workspaceDir: workDir,
  stateDir: path.join(workDir, ".general-agent-state"),
  agentDir: path.join(workDir, ".general-agent-agent"),
  profileId: "default",
  pluginMode: "disabled", // 先关闭插件，保持简单
  logger,
  sessionStore,
  // API Key 从 process.env.ANTHROPIC_API_KEY 自动读取
  // 也可以显式传入：anthropicApiKey: "sk-..."
});

// ─── 4. 创建会话 ─────────────────────────────────────────────
const sessionId = randomUUID();

const session = sdk.createSession({
  identity: {
    mode: "general", // "general" | "coding"
    sessionId,
    sessionKey: `host:default:general`,
  },
  systemPrompt: "You are a helpful assistant. Answer concisely.",
  modelRef: "claude-sonnet-4-20250514",
  sessionFile: path.join(os.tmpdir(), `general-agent-${sessionId}.jsonl`),
});

// ─── 5. 流式对话 ─────────────────────────────────────────────
console.log("\n🚀 发送消息: 什么是 Agent SDK？用一句话回答。\n");

let fullResponse = "";

for await (const event of session.streamTurn({
  role: "user",
  content: [{ type: "text", text: "什么是 Agent SDK？用一句话回答。" }],
})) {
  switch (event.kind) {
    // ── 流式文本 ──
    case "assistant_delta":
      process.stdout.write(event.text);
      fullResponse += event.text;
      break;

    // ── 推理过程（extended thinking 模型） ──
    case "reasoning_delta":
      // 可选：展示模型的思考过程
      // process.stdout.write(chalk.dim(event.text));
      break;

    // ── SDK 内建工具调用（read/write/exec 等） ──
    case "tool_call":
      console.log(`\n🔧 工具调用: ${event.toolName}(${JSON.stringify(event.input)})`);
      break;
    case "tool_result":
      console.log(`✅ 工具结果: ${event.toolName} → ${JSON.stringify(event.output).slice(0, 200)}`);
      break;
    case "tool_error":
      console.log(`❌ 工具错误: ${event.toolName} → ${event.error}`);
      break;

    // ── Token 用量 ──
    case "usage_snapshot":
      console.log(
        `\n📊 用量: ${event.snapshot.usedInputTokens} tokens (${event.snapshot.usedPct}%)`
      );
      break;

    // ── Turn 结束 ──
    case "turn_complete":
      console.log(`\n\n✅ Turn 完成 (${event.stopReason})`);
      break;
  }
}

// ─── 6. 清理 ─────────────────────────────────────────────────
await sdk.shutdown();
console.log("\n🏁 SDK 已关闭。");
