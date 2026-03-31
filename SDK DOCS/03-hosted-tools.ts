/**
 * 03-hosted-tools.ts
 *
 * 宿主工具 (Hosted Tools) 示例：
 *  - 注册宿主自定义工具
 *  - 监听 hosted_tool_call 事件
 *  - 执行工具逻辑后通过 submitHostedToolResult/Error 恢复 Agent 执行
 *
 * 这是 SDK 最核心的能力之一——Agent 可以调用宿主定义的任意工具，
 * 宿主完全控制工具的执行逻辑。
 *
 * 运行:
 *   ANTHROPIC_API_KEY=sk-... npx tsx "SDK DOCS/03-hosted-tools.ts"
 *
 * 如果使用代理服务：
 *   ANTHROPIC_BASE_URL=https://gru.ai/api/ai-proxy/anthropic
 */
import { createGeneralAgentSdk } from "general-agent-sdk";
import type {
  GeneralAgentHostedToolDefinition,
  GeneralAgentStreamEvent,
  GeneralAgentSession,
} from "general-agent-sdk";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";

// ─── 1. 定义宿主工具 ────────────────────────────────────────
// 这些工具由宿主应用实现，Agent 会在需要时调用它们

const hostedTools: GeneralAgentHostedToolDefinition[] = [
  {
    name: "get_weather",
    description: "Get the current weather for a given city.",
    inputSchema: {
      type: "object",
      properties: {
        city: { type: "string", description: "The city name" },
      },
      required: ["city"],
    },
  },
  {
    name: "send_notification",
    description: "Send a notification to the user's device.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Notification title" },
        body: { type: "string", description: "Notification body" },
      },
      required: ["title", "body"],
    },
  },
];

// ─── 2. 宿主工具执行器 ──────────────────────────────────────
// 模拟真实的工具执行——在生产环境中这里会调用真实 API

async function executeHostedTool(
  toolName: string,
  input: Record<string, unknown>,
): Promise<{ output?: unknown; error?: string }> {
  console.log(`  🔩 [宿主] 执行工具: ${toolName}(${JSON.stringify(input)})`);

  switch (toolName) {
    case "get_weather": {
      // 模拟天气 API
      const city = input.city as string;
      return {
        output: {
          city,
          temperature: "22°C",
          condition: "晴",
          humidity: "45%",
        },
      };
    }
    case "send_notification": {
      // 模拟发送通知
      console.log(`  📱 [宿主] 已发送通知: ${input.title} — ${input.body}`);
      return { output: { success: true, sentAt: new Date().toISOString() } };
    }
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ─── 3. 核心循环：处理流式事件 + Hosted Tool 挂起/恢复 ──────
/**
 * 这是 hosted tool 模式的核心模式 (pattern):
 *
 * 1. 消费 streamTurn() 的事件流
 * 2. 遇到 hosted_tool_call → SDK 自动挂起 Agent 执行
 * 3. 宿主执行工具逻辑
 * 4. 调用 submitHostedToolResult() → SDK 恢复 Agent 执行
 * 5. 继续消费恢复后的事件流
 * 6. 重复 2-5 直到 turn_complete
 */
async function runConversation(
  session: GeneralAgentSession,
  userMessage: string,
): Promise<string> {
  console.log(`\n💬 User: ${userMessage}\n`);

  let fullResponse = "";
  let currentStream: AsyncIterable<GeneralAgentStreamEvent> = session.streamTurn({
    role: "user",
    content: [{ type: "text", text: userMessage }],
  });

  // 可能需要多次恢复（Agent 可能连续调用多个 hosted tool）
  let done = false;
  while (!done) {
    for await (const event of currentStream) {
      switch (event.kind) {
        case "assistant_delta":
          process.stdout.write(event.text);
          fullResponse += event.text;
          break;

        case "hosted_tool_call": {
          // 🔑 核心：Agent 要求调用宿主工具
          console.log(`\n\n⏸️  Agent 请求宿主工具: ${event.toolName}`);
          console.log(`   CallID: ${event.callId}`);
          console.log(`   Input:  ${JSON.stringify(event.input)}`);

          // 执行工具
          const result = await executeHostedTool(event.toolName, event.input);

          // 🔑 核心：提交结果，恢复 Agent 执行
          if (result.error) {
            console.log(`  ❌ 工具错误: ${result.error}`);
            currentStream = session.submitHostedToolError({
              callId: event.callId,
              error: result.error,
            });
          } else {
            console.log(`  ✅ 工具结果: ${JSON.stringify(result.output)}`);
            currentStream = session.submitHostedToolResult({
              callId: event.callId,
              output: result.output,
            });
          }
          // 跳出内层 for-await，用新的 currentStream 继续外层 while
          break;
        }

        case "turn_complete":
          console.log(`\n\n✅ Turn 完成 (${event.stopReason})`);
          done = true;
          break;

        case "usage_snapshot":
          console.log(
            `\n📊 用量: ${event.snapshot.usedInputTokens} tokens (${event.snapshot.usedPct}%)`,
          );
          break;
      }

      // hosted_tool_call 后需要跳出内层循环
      if (event.kind === "hosted_tool_call") break;
    }
  }

  return fullResponse;
}

// ─── 4. 启动 ─────────────────────────────────────────────────
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
    async load() { return null; },
    async save() {},
    async resolveSessionFile(id) {
      return path.join(os.tmpdir(), `general-agent-${id.sessionId}.jsonl`);
    },
  },
  hostedTools, // ← 注册宿主工具
});

const sessionId = randomUUID();
const session = sdk.createSession({
  identity: { mode: "general", sessionId, sessionKey: `tools:${sessionId}` },
  systemPrompt: [
    "You are a helpful assistant with access to tools.",
    "When the user asks about weather, use the get_weather tool.",
    "When you have useful information, use send_notification to alert the user.",
  ].join("\n"),
  modelRef: "anthropic/claude-sonnet-4-20250514",
  sessionFile: path.join(os.tmpdir(), `general-agent-${sessionId}.jsonl`),
});

// 发送一条会触发工具调用的消息
await runConversation(session, "北京今天天气怎么样？查到结果后发个通知给我。");

await sdk.shutdown();
console.log("\n🏁 Done.");
