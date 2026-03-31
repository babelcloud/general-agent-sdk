/**
 * 04-session-lifecycle.ts
 *
 * 会话生命周期管理：
 *  - 创建会话 (createSession)
 *  - 列举已存储的会话 (listSessions)
 *  - 恢复已有会话 (resumeSession)
 *  - 分叉会话 (forkSession)
 *  - 重置会话 (session.reset)
 *  - 读取会话历史 (readSessionHistory)
 *  - 获取用量快照 (getUsageSnapshot)
 *
 * 运行: ANTHROPIC_API_KEY=sk-... npx tsx "SDK DOCS/04-session-lifecycle.ts"
 */
import { createGeneralAgentSdk } from "general-agent-sdk";
import type { GeneralAgentStreamEvent } from "general-agent-sdk";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// ─── 文件系统持久化适配器 ──────────────────────────────────
// 生产级实现：将 session 状态写入 JSON 文件
const stateRoot = path.join(os.tmpdir(), `general-agent-lifecycle-demo-${Date.now()}`);
fs.mkdirSync(stateRoot, { recursive: true });
const sessionsDir = path.join(stateRoot, "sessions");
fs.mkdirSync(sessionsDir, { recursive: true });

const sessionStore = {
  async load(identity: any) {
    const filePath = path.join(sessionsDir, `${identity.sessionKey.replace(/[:/]/g, "_")}.json`);
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  async save(identity: any, value: any) {
    const filePath = path.join(sessionsDir, `${identity.sessionKey.replace(/[:/]/g, "_")}.json`);
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  },
  async resolveSessionFile(identity: any) {
    return path.join(stateRoot, `${identity.sessionId}.jsonl`);
  },
};

const logger = {
  onDebug() {},
  onInfo() {},
  onWarn({ message }: any) { console.warn(`⚠️  ${message}`); },
  onError({ message }: any) { console.error(`❌ ${message}`); },
};

// ─── 辅助 ───────────────────────────────────────────────────
async function chat(stream: AsyncIterable<GeneralAgentStreamEvent>): Promise<string> {
  let text = "";
  for await (const event of stream) {
    if (event.kind === "assistant_delta") {
      process.stdout.write(event.text);
      text += event.text;
    }
    if (event.kind === "turn_complete") console.log();
  }
  return text;
}

// ─── 主流程 ──────────────────────────────────────────────────
const sdk = await createGeneralAgentSdk({
  workspaceDir: stateRoot,
  stateDir: path.join(stateRoot, "state"),
  agentDir: path.join(stateRoot, "agent"),
  profileId: "default",
  pluginMode: "disabled",
  logger,
  sessionStore,
});

// ─── 1. 创建会话 ─────────────────────────────────────────────
console.log("\n─── 1. 创建会话 ─────────────────────────────────");

const sessionId = randomUUID();
const session = sdk.createSession({
  identity: {
    mode: "general",
    sessionId,
    sessionKey: `host:default:${sessionId}`,
  },
  systemPrompt: "You are a helpful assistant. Be concise.",
  modelRef: "claude-sonnet-4-20250514",
  sessionFile: path.join(stateRoot, `${sessionId}.jsonl`),
});

console.log(`创建会话: ${session.getSessionId()}`);

// 做一轮对话以填充状态
process.stdout.write("AI > ");
await chat(session.streamTurn({
  role: "user",
  content: [{ type: "text", text: "My secret number is 42. Remember it." }],
}));

// ─── 2. 获取用量快照 ───────────────────────────────────────
console.log("\n─── 2. 获取用量快照 ────────────────────────────");

const usage = session.getUsageSnapshot();
if (usage) {
  console.log(`Input tokens: ${usage.usedInputTokens}`);
  console.log(`Context window: ${usage.contextWindow}`);
  console.log(`Usage: ${usage.usedPct}%`);
}

// ─── 3. 列举会话 ─────────────────────────────────────────────
console.log("\n─── 3. 列举会话 ────────────────────────────────");

const allSessions = await sdk.listSessions();
console.log(`已存储的会话数量: ${allSessions.length}`);
for (const s of allSessions) {
  console.log(`  - ${s.sessionId} (${s.mode}, model: ${s.modelRef})`);
}

// ─── 4. 读取会话历史 ─────────────────────────────────────────
console.log("\n─── 4. 读取会话历史 ────────────────────────────");

const history = await sdk.readSessionHistory(sessionId);
console.log(`历史条目数量: ${history.length}`);
for (const entry of history) {
  console.log(`  [${entry.type}] ${entry.timestamp ? new Date(entry.timestamp).toISOString() : "N/A"}`);
}

// ─── 5. 重置会话 ─────────────────────────────────────────────
console.log("\n─── 5. 重置会话 ────────────────────────────────");

await session.reset("demo-reset");
console.log("会话已重置——消息历史清除，身份保留");

// 重置后仍可继续对话
process.stdout.write("AI (重置后) > ");
await chat(session.streamTurn({
  role: "user",
  content: [{ type: "text", text: "What secret number did I tell you?" }],
}));
// 由于重置，模型不会记得 42

// ─── 6. 分叉会话（略）─────────────────────────────────────────
// forkSession 在有持久化会话时可用：
//
// const forked = await sdk.forkSession(sessionId, {
//   identity: {
//     mode: "general",
//     sessionId: randomUUID(),
//     sessionKey: "host:default:forked",
//   },
//   sessionFile: path.join(stateRoot, "forked.jsonl"),
// });
//
// 分叉会话继承父会话的完整消息历史，但独立演化。

// ─── 清理 ─────────────────────────────────────────────────
await sdk.shutdown();
fs.rmSync(stateRoot, { recursive: true, force: true });
console.log("\n🏁 Done.");
