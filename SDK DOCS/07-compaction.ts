/**
 * 07-compaction.ts
 *
 * 上下文压缩示例：
 *  - 监控 token 用量
 *  - 当上下文窗口使用率过高时自动触发压缩
 *  - 处理 compaction_started / compaction_finished 事件
 *
 * 长对话场景的必备能力——避免 context window 溢出。
 * 上下文窗口大小根据模型自动解析（如 Claude 200K, GPT-4o 128K 等）。
 *
 * 运行: ANTHROPIC_API_KEY=sk-... npx tsx "SDK DOCS/07-compaction.ts"
 */
import { createGeneralAgentSdk } from "general-agent-sdk";
import type { GeneralAgentSession, GeneralAgentStreamEvent } from "general-agent-sdk";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";

// ─── 适配器（复用简化版） ────────────────────────────────────
const sessions = new Map<string, unknown>();

const sdk = await createGeneralAgentSdk({
  workspaceDir: process.cwd(),
  stateDir: path.join(process.cwd(), ".general-agent-state"),
  agentDir: path.join(process.cwd(), ".general-agent-agent"),
  profileId: "default",
  pluginMode: "disabled",
  logger: {
    onDebug() {},
    onInfo() {},
    onWarn({ message }) { console.warn(`⚠️  ${message}`); },
    onError({ message }) { console.error(`❌ ${message}`); },
  },
  sessionStore: {
    async load(id) { return (sessions.get(id.sessionKey) as any) ?? null; },
    async save(id, v) { sessions.set(id.sessionKey, v); },
    async resolveSessionFile(id) {
      return path.join(os.tmpdir(), `general-agent-${id.sessionId}.jsonl`);
    },
  },
});

const sessionId = randomUUID();
const session = sdk.createSession({
  identity: { mode: "general", sessionId, sessionKey: `compact:${sessionId}` },
  systemPrompt: "You are a helpful assistant. Be thorough in your answers.",
  modelRef: "anthropic/claude-sonnet-4-20250514",
  sessionFile: path.join(os.tmpdir(), `general-agent-${sessionId}.jsonl`),
});

// ─── 辅助：发一条消息并消费流式事件 ─────────────────────────
async function chat(session: GeneralAgentSession, message: string): Promise<void> {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`💬 User: ${message}\n`);

  for await (const event of session.streamTurn({
    role: "user",
    content: [{ type: "text", text: message }],
  })) {
    switch (event.kind) {
      case "assistant_delta":
        process.stdout.write(event.text);
        break;

      case "usage_snapshot":
        console.log(
          `\n📊 用量: ${event.snapshot.usedInputTokens}/${event.snapshot.contextWindow} ` +
          `tokens (${event.snapshot.usedPct}%)`,
        );
        break;

      // ── 压缩事件 ──
      case "compaction_started":
        console.log(`\n🗜️  压缩开始: ${event.reason}`);
        break;

      case "compaction_finished":
        console.log(
          `✅ 压缩完成: ${event.reason}` +
          (event.tokensAfter != null ? ` → ${event.tokensAfter} tokens` : ""),
        );
        break;

      case "turn_complete":
        console.log(`\n✅ Turn 完成 (${event.stopReason})\n`);
        break;
    }
  }

  // ── 每轮结束后主动检查是否需要压缩 ──
  // 阈值 85% 是默认值，cooldown 60s 防止频繁压缩
  await session.maybeCompactByTokens({
    usedPctThreshold: 85, // 使用率超过 85% 时触发
    cooldownMs: 60_000,    // 两次压缩之间至少间隔 60 秒
  });

  // 也可以无条件手动触发：
  // await session.requestCompaction();
}

// ─── 模拟多轮长对话 ─────────────────────────────────────────
console.log("🚀 开始多轮对话，观察上下文压缩行为...\n");

await chat(session, "请详细介绍一下 TypeScript 的类型系统设计哲学。");
await chat(session, "那 Rust 的所有权和借用机制和 TypeScript 有什么根本区别？");
await chat(session, "结合前面的讨论，你觉得什么样的类型系统最适合 AI Agent 开发？");

// 查看最终用量
const usage = session.getUsageSnapshot();
if (usage) {
  console.log(`\n📈 最终用量: ${usage.usedInputTokens} tokens (${usage.usedPct}%)`);
}

await sdk.shutdown();
console.log("🏁 Done.");
