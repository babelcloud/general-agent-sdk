/**
 * 08-subagents.ts
 *
 * 子代理 (Subagents) 示例：
 *  - SDK 内建的 `subagents` 工具让 Agent 可以自主创建子代理
 *  - 子代理拥有独立的消息历史和 system prompt
 *  - 子代理工具集排除 `subagents` 自身（防止递归）
 *  - 子代理完成后输出自动作为工具结果返回给父 Agent
 *  - 4 个生命周期 hook 自动触发
 *
 * 注意：subagents 是 SDK 内建核心工具，模型会自行决定何时使用。
 * 你可以通过 system prompt 引导模型在合适场景使用子代理。
 *
 * 运行: ANTHROPIC_API_KEY=sk-... npx tsx "SDK DOCS/08-subagents.ts"
 */
import { createGeneralAgentSdk } from "general-agent-sdk";
import type {
  GeneralAgentHookRegistration,
  GeneralAgentStreamEvent,
} from "general-agent-sdk";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";

// ─── 注册子代理生命周期 Hook ────────────────────────────────
const hooks: GeneralAgentHookRegistration[] = [
  {
    pluginId: "demo",
    hookName: "subagent_spawning",
    handler: (event) => {
      console.log(`\n  🐣 [subagent_spawning] 子代理即将创建`);
      console.log(`     Label: ${event.label ?? "N/A"}`);
      console.log(`     Mode: ${event.mode}`);
      // 返回 { status: "error", error: "reason" } 可以阻止创建
      return { status: "ok" as const };
    },
  },
  {
    pluginId: "demo",
    hookName: "subagent_spawned",
    handler: (event) => {
      console.log(`  ✅ [subagent_spawned] 子代理已就绪: ${event.childSessionKey}`);
    },
  },
  {
    pluginId: "demo",
    hookName: "subagent_ended",
    handler: (event) => {
      console.log(`  🏁 [subagent_ended] 子代理完成: ${event.outcome ?? "ok"}`);
    },
  },
];

// ─── 初始化 SDK ─────────────────────────────────────────────
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
  hooks,
});

const sessionId = randomUUID();
const session = sdk.createSession({
  identity: { mode: "general", sessionId, sessionKey: `subagent:${sessionId}` },
  // 在 system prompt 中引导模型使用子代理
  systemPrompt: [
    "You are a project manager AI. When asked to complete a multi-step task,",
    "use the `subagents` tool to delegate each sub-task to a specialized child agent.",
    "Each subagent receives its own instructions and works independently.",
    "",
    "The subagents tool accepts:",
    "  - task: the specific task to delegate",
    "  - instructions: system prompt for the child agent",
    "  - allowedTools: (optional) restrict which tools the child can use",
  ].join("\n"),
  modelRef: "claude-sonnet-4-20250514",
  sessionFile: path.join(os.tmpdir(), `general-agent-${sessionId}.jsonl`),
});

console.log("💬 发送任务（观察子代理创建）...\n");

for await (const event of session.streamTurn({
  role: "user",
  content: [{
    type: "text",
    text: "Use a subagent to write a haiku about TypeScript. Give the subagent clear instructions.",
  }],
})) {
  switch (event.kind) {
    case "assistant_delta":
      process.stdout.write(event.text);
      break;
    case "tool_call":
      console.log(`\n🔧 工具调用: ${event.toolName}`);
      if (event.toolName === "subagents") {
        console.log(`   Task: ${JSON.stringify(event.input).slice(0, 200)}`);
      }
      break;
    case "tool_result":
      console.log(`✅ 工具结果: ${event.toolName} → ${JSON.stringify(event.output).slice(0, 300)}`);
      break;
    case "turn_complete":
      console.log(`\n\n✅ Turn 完成 (${event.stopReason})`);
      break;
  }
}

await sdk.shutdown();
console.log("\n🏁 Done.");

/*
 * ─── subagents 工具参数参考 ──────────────────────────────
 *
 * {
 *   task: string           // 子代理要完成的具体任务
 *   instructions: string   // 子代理的 system prompt
 *   allowedTools?: string[] // 限制子代理可用的工具（可选）
 * }
 *
 * 子代理特性：
 * - 独立消息历史（不共享父代理的对话上下文）
 * - 独立 system prompt（来自 instructions 参数）
 * - 工具集继承父代理，但排除 subagents（防止无限递归）
 * - 可通过 allowedTools 进一步限制
 * - 完成后输出作为 tool_result 返回给父代理
 *
 * 生命周期 Hook：
 * - subagent_spawning  → 创建前（可阻止）
 * - subagent_delivery_target → 交付目标确定
 * - subagent_spawned   → 创建后
 * - subagent_ended     → 完成后
 */
