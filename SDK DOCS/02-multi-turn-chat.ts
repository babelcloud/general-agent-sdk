/**
 * 02-multi-turn-chat.ts
 *
 * 多轮对话示例：在同一会话中进行多次 turn 交互。
 * SDK 内部自动累积消息历史，让模型在 turn 间保持记忆。
 *
 * 运行: ANTHROPIC_API_KEY=sk-... npx tsx "SDK DOCS/02-multi-turn-chat.ts"
 */
import { createGeneralAgentSdk } from "general-agent-sdk";
import type { GeneralAgentSession, GeneralAgentStreamEvent } from "general-agent-sdk";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

// ─── 辅助：最简适配器（同 01 示例） ──────────────────────────
const logger = {
  onDebug() {},
  onInfo() {},
  onWarn({ message }: any) { console.warn(`⚠️  ${message}`); },
  onError({ message }: any) { console.error(`❌ ${message}`); },
};

const sessions = new Map<string, unknown>();
const sessionStore = {
  async load(identity: any) { return (sessions.get(identity.sessionKey) as any) ?? null; },
  async save(identity: any, value: any) { sessions.set(identity.sessionKey, value); },
  async resolveSessionFile(identity: any) {
    return path.join(os.tmpdir(), `general-agent-${identity.sessionId}.jsonl`);
  },
};

// ─── 辅助：消费一个 turn 的所有事件，拼接 assistant 文本 ─────
async function consumeTurn(
  stream: AsyncIterable<GeneralAgentStreamEvent>,
): Promise<string> {
  let text = "";
  for await (const event of stream) {
    if (event.kind === "assistant_delta") {
      process.stdout.write(event.text);
      text += event.text;
    }
    if (event.kind === "turn_complete") {
      console.log(); // 换行
    }
  }
  return text;
}

// ─── 主逻辑 ──────────────────────────────────────────────────
const sdk = await createGeneralAgentSdk({
  workspaceDir: process.cwd(),
  stateDir: path.join(process.cwd(), ".general-agent-state"),
  agentDir: path.join(process.cwd(), ".general-agent-agent"),
  profileId: "default",
  pluginMode: "disabled",
  logger,
  sessionStore,
});

const sessionId = randomUUID();
const session = sdk.createSession({
  identity: { mode: "general", sessionId, sessionKey: `chat:${sessionId}` },
  systemPrompt: "You are a friendly assistant. Remember the user's context across turns.",
  modelRef: "claude-sonnet-4-20250514",
  sessionFile: path.join(os.tmpdir(), `general-agent-${sessionId}.jsonl`),
});

// ── 交互式 REPL ──
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log("🤖 General Agent SDK 多轮对话 (输入 'quit' 退出)\n");

const askQuestion = () => {
  rl.question("You > ", async (input) => {
    if (!input || input.trim().toLowerCase() === "quit") {
      console.log("\n👋 再见！");
      await sdk.shutdown();
      rl.close();
      return;
    }

    process.stdout.write("AI  > ");

    await consumeTurn(
      session.streamTurn({
        role: "user",
        content: [{ type: "text", text: input }],
      }),
    );

    askQuestion(); // 继续下一轮
  });
};

askQuestion();
