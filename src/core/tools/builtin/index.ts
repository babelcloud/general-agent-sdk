import type { BuiltinTool } from "./types.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { editTool } from "./edit.js";
import { execTool } from "./exec.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { processTool } from "./process.js";
import { webSearchTool } from "./web-search.js";
import { webFetchTool } from "./web-fetch.js";
import { browserTool } from "./browser.js";
import { canvasTool } from "./canvas.js";
import { messageTool } from "./message.js";
import { agentsListTool } from "./agents-list.js";
import { sessionsListTool } from "./sessions-list.js";
import { sessionsHistoryTool } from "./sessions-history.js";
import { sessionsSendTool } from "./sessions-send.js";
import { sessionsSpawnTool } from "./sessions-spawn.js";
import { sessionsYieldTool } from "./sessions-yield.js";
import { subagentsTool } from "./subagents.js";
import { sessionStatusTool } from "./session-status.js";
import { memoryGetTool } from "./memory-get.js";
import { memorySearchTool } from "./memory-search.js";
import { ttsTool } from "./tts.js";

export type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

export const ALL_BUILTIN_TOOLS: BuiltinTool[] = [
  // Core filesystem tools
  readTool,
  writeTool,
  editTool,
  execTool,
  globTool,
  grepTool,
  // Process management
  processTool,
  // Web tools
  webSearchTool,
  webFetchTool,
  // Browser
  browserTool,
  // Canvas
  canvasTool,
  // Messaging
  messageTool,
  // Agent & session management
  agentsListTool,
  sessionsListTool,
  sessionsHistoryTool,
  sessionsSendTool,
  sessionsSpawnTool,
  sessionsYieldTool,
  subagentsTool,
  sessionStatusTool,
  // Memory
  memoryGetTool,
  memorySearchTool,
  // TTS
  ttsTool,
];

export function getBuiltinToolByName(name: string): BuiltinTool | undefined {
  return ALL_BUILTIN_TOOLS.find((t) => t.definition.name === name);
}

export {
  readTool,
  writeTool,
  editTool,
  execTool,
  globTool,
  grepTool,
  processTool,
  webSearchTool,
  webFetchTool,
  browserTool,
  canvasTool,
  messageTool,
  agentsListTool,
  sessionsListTool,
  sessionsHistoryTool,
  sessionsSendTool,
  sessionsSpawnTool,
  sessionsYieldTool,
  subagentsTool,
  sessionStatusTool,
  memoryGetTool,
  memorySearchTool,
  ttsTool,
};
