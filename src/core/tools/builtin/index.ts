import type { BuiltinTool } from "./types.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { editTool } from "./edit.js";
import { execTool } from "./exec.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";

export type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

export const ALL_BUILTIN_TOOLS: BuiltinTool[] = [
  readTool,
  writeTool,
  editTool,
  execTool,
  globTool,
  grepTool,
];

export function getBuiltinToolByName(name: string): BuiltinTool | undefined {
  return ALL_BUILTIN_TOOLS.find((t) => t.definition.name === name);
}

export { readTool, writeTool, editTool, execTool, globTool, grepTool };
