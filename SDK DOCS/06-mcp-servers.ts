/**
 * 06-mcp-servers.ts
 *
 * MCP (Model Context Protocol) 服务器集成示例：
 *  - 动态注册 stdio MCP 服务器
 *  - 动态注册 http MCP 服务器
 *  - 查询 MCP 服务器状态
 *  - 启用/禁用 MCP 服务器
 *
 * MCP 让你的 Agent 可以使用外部工具服务器提供的工具，
 * 而无需在 SDK 内部实现这些工具。
 *
 * 运行: ANTHROPIC_API_KEY=sk-... npx tsx "SDK DOCS/06-mcp-servers.ts"
 *
 * 注意: 本示例需要一个可用的 MCP 服务器。
 * 如果你没有，可以用 @modelcontextprotocol/server-filesystem 等现成的 MCP 服务器。
 */
import { createGeneralAgentSdk } from "general-agent-sdk";
import type { GeneralAgentMcpServerConfig } from "general-agent-sdk";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";

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
});

const sessionId = randomUUID();
const session = sdk.createSession({
  identity: { mode: "general", sessionId, sessionKey: `mcp:${sessionId}` },
  systemPrompt: "You are a helpful assistant with access to MCP tools.",
  modelRef: "claude-sonnet-4-20250514",
  sessionFile: path.join(os.tmpdir(), `general-agent-${sessionId}.jsonl`),
});

// ─── 1. 注册 stdio MCP 服务器 ───────────────────────────────
// stdio 模式：SDK 启动一个子进程，通过 stdin/stdout 通信
console.log("─── 1. 注册 stdio MCP 服务器 ────────────────────");

session.setDynamicMcpServers({
  // 示例：注册一个文件系统 MCP 服务器
  filesystem: {
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    // 可选：
    // cwd: "/path/to/working/directory",
    // env: { NODE_ENV: "production" },
  },
});

console.log("  ✅ 已注册 'filesystem' MCP 服务器 (stdio)");

// ─── 2. 注册 http MCP 服务器 ────────────────────────────────
// http 模式：连接远程 HTTP MCP 端点
console.log("\n─── 2. 注册 http MCP 服务器 ────────────────────");

// 注意：可以追加新的服务器（不影响已注册的）
const currentServers = session.getDynamicMcpServers();
session.setDynamicMcpServers({
  ...currentServers,
  remote_tools: {
    transport: "http",
    url: "https://mcp.example.com/api",
    headers: {
      Authorization: "Bearer your-token",
    },
  },
});

console.log("  ✅ 已注册 'remote_tools' MCP 服务器 (http)");
console.log(`  当前服务器数量: ${Object.keys(session.getDynamicMcpServers()).length}`);

// ─── 3. 查询 MCP 服务器状态 ─────────────────────────────────
console.log("\n─── 3. 查询 MCP 服务器状态 ─────────────────────");

const query = session.getCurrentQuery();
if (query?.mcpServerStatus) {
  const statuses = await query.mcpServerStatus();
  for (const s of statuses) {
    console.log(`  ${s.serverName}: ${s.enabled ? "✅ 启用" : "❌ 禁用"} | ` +
      `transport: ${s.transport} | supported: ${s.supported}` +
      (s.error ? ` | error: ${s.error}` : ""));
  }
}

// ─── 4. 启用/禁用 MCP 服务器 ────────────────────────────────
console.log("\n─── 4. 启用/禁用 MCP 服务器 ────────────────────");

if (query?.toggleMcpServer) {
  // 禁用一个服务器（工具暂时不可用，但配置保留）
  await query.toggleMcpServer("remote_tools", false);
  console.log("  ⏸️  已禁用 'remote_tools'");

  // 重新启用
  await query.toggleMcpServer("remote_tools", true);
  console.log("  ▶️  已重新启用 'remote_tools'");
}

// ─── 5. MCP 工具在 Agent 中的使用 ───────────────────────────
console.log("\n─── 5. MCP 工具在 Agent 中的使用 ───────────────");
console.log("  MCP 服务器提供的工具会自动注入到 Agent 的工具列表中。");
console.log("  Agent 可以像使用内建工具一样调用 MCP 工具。");
console.log("  工具调用和结果事件的 kind 仍然是 'tool_call' 和 'tool_result'。");

// 如果你有真实的 MCP 服务器可用，取消下面的注释来测试：
//
// for await (const event of session.streamTurn({
//   role: "user",
//   content: [{ type: "text", text: "List the files in /tmp" }],
// })) {
//   if (event.kind === "assistant_delta") process.stdout.write(event.text);
//   if (event.kind === "tool_call") console.log(`\n🔧 MCP工具: ${event.toolName}`);
//   if (event.kind === "tool_result") console.log(`✅ 结果: ${JSON.stringify(event.output).slice(0, 200)}`);
//   if (event.kind === "turn_complete") console.log();
// }

await sdk.shutdown();
console.log("\n🏁 Done.");

/*
 * ─── MCP 服务器配置参考 ──────────────────────────────────
 *
 * stdio 模式:
 * {
 *   transport: "stdio",
 *   command: "node",           // 可执行文件
 *   args?: ["server.js"],      // 命令行参数
 *   cwd?: "/path/to/dir",     // 工作目录
 *   env?: { KEY: "value" },    // 环境变量
 * }
 *
 * http 模式:
 * {
 *   transport: "http",
 *   url: "https://mcp.example.com/api",  // 端点 URL
 *   headers?: { Authorization: "..." },   // HTTP 头
 * }
 */
