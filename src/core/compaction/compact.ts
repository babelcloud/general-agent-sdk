import type { AgentMessage } from "../../loop/agent-types.js";
import type { UserMessage, AssistantMessage, ToolResultMessage } from "../../providers/anthropic-types.js";

/**
 * Options for truncation-based compaction.
 */
export interface CompactionOptions {
  /**
   * Number of recent messages to keep intact (default 10).
   * These are preserved verbatim at the end of the history.
   */
  keepRecentCount?: number;
}

/**
 * Result of a compaction operation.
 */
export interface CompactionResult {
  /** The compacted message array (summary + recent messages). */
  messages: AgentMessage[];
  /** Number of messages that were removed / summarized. */
  removedCount: number;
  /** Approximate token count of the compacted history (rough char/4 estimate). */
  estimatedTokens: number;
}

/**
 * Classify an agent message for summary statistics.
 */
function classifyMessage(msg: AgentMessage): "user" | "assistant" | "tool_result" | "unknown" {
  if (msg && typeof msg === "object" && "role" in msg) {
    const role = (msg as { role: string }).role;
    if (role === "user") return "user";
    if (role === "assistant") return "assistant";
    if (role === "toolResult") return "tool_result";
  }
  return "unknown";
}

/**
 * Extract a short text preview from a message for the summary.
 */
function messagePreview(msg: AgentMessage, maxLen = 80): string {
  if (!msg || typeof msg !== "object" || !("role" in msg)) {
    return "(unknown)";
  }

  const typed = msg as UserMessage | AssistantMessage | ToolResultMessage;

  if (typed.role === "user") {
    const text = typeof typed.content === "string"
      ? typed.content
      : (typed.content as Array<{ type: string; text?: string }>)
          .filter((c) => c.type === "text" && c.text)
          .map((c) => c.text)
          .join(" ");
    return truncate(text, maxLen);
  }

  if (typed.role === "assistant") {
    const text = (typed as AssistantMessage).content
      .filter((c): c is Extract<AssistantMessage["content"][number], { type: "text" }> => c.type === "text")
      .map((c) => c.text)
      .join(" ");
    const toolCalls = (typed as AssistantMessage).content.filter((c) => c.type === "toolCall");
    const suffix = toolCalls.length > 0 ? ` [+${toolCalls.length} tool call(s)]` : "";
    return truncate(text, maxLen - suffix.length) + suffix;
  }

  if (typed.role === "toolResult") {
    const tr = typed as ToolResultMessage;
    const label = tr.isError ? "error" : "result";
    const text = tr.content
      .filter((c): c is Extract<ToolResultMessage["content"][number], { type: "text" }> => c.type === "text")
      .map((c) => c.text)
      .join(" ");
    return `[${tr.toolName} ${label}] ${truncate(text, maxLen - tr.toolName.length - label.length - 5)}`;
  }

  return "(unknown)";
}

function truncate(text: string, maxLen: number): string {
  const cleaned = text.replace(/\n/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 3) + "...";
}

/**
 * Estimate token count for a message array using a rough chars/4 heuristic.
 */
function estimateTokens(messages: AgentMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    chars += JSON.stringify(msg).length;
  }
  return Math.ceil(chars / 4);
}

/**
 * Build a summary text block describing the compacted messages.
 */
function buildSummaryText(removed: AgentMessage[]): string {
  const counts = { user: 0, assistant: 0, tool_result: 0, unknown: 0 };
  const toolNames = new Set<string>();

  for (const msg of removed) {
    const kind = classifyMessage(msg);
    counts[kind] += 1;
    if (
      msg &&
      typeof msg === "object" &&
      "role" in msg &&
      (msg as { role: string }).role === "toolResult"
    ) {
      const tr = msg as ToolResultMessage;
      if (tr.toolName) {
        toolNames.add(tr.toolName);
      }
    }
  }

  const parts: string[] = [
    `[Conversation History Compacted]`,
    `The following is a summary of ${removed.length} earlier messages that have been compacted to save context space.`,
    ``,
    `Message breakdown:`,
  ];

  if (counts.user > 0) parts.push(`- ${counts.user} user message(s)`);
  if (counts.assistant > 0) parts.push(`- ${counts.assistant} assistant message(s)`);
  if (counts.tool_result > 0) {
    const toolList = toolNames.size > 0 ? ` (tools: ${[...toolNames].join(", ")})` : "";
    parts.push(`- ${counts.tool_result} tool result(s)${toolList}`);
  }

  // Add brief previews of the compacted messages (first few and last few)
  parts.push("");
  parts.push("Key points from compacted history:");

  const previewCount = Math.min(removed.length, 6);
  const headCount = Math.min(3, previewCount);
  const tailCount = previewCount - headCount;

  for (let i = 0; i < headCount; i++) {
    const kind = classifyMessage(removed[i]);
    parts.push(`  ${i + 1}. [${kind}] ${messagePreview(removed[i])}`);
  }

  if (removed.length > previewCount) {
    parts.push(`  ... (${removed.length - previewCount} messages omitted) ...`);
  }

  if (tailCount > 0) {
    const startIdx = removed.length - tailCount;
    for (let i = startIdx; i < removed.length; i++) {
      const kind = classifyMessage(removed[i]);
      parts.push(`  ${i + 1}. [${kind}] ${messagePreview(removed[i])}`);
    }
  }

  return parts.join("\n");
}

/**
 * Perform truncation-based compaction on a message history.
 *
 * This is a v1 lightweight approach that does NOT make an LLM call.
 * It keeps the most recent `keepRecentCount` messages intact and replaces
 * all earlier messages with a synthetic user message containing a text
 * summary of what was removed.
 *
 * @param messages - Current conversation message history.
 * @param options  - Compaction configuration.
 * @returns The compaction result with the new message array.
 */
export function compactMessages(
  messages: AgentMessage[],
  options?: CompactionOptions,
): CompactionResult {
  const keepRecent = options?.keepRecentCount ?? 10;

  // Nothing to compact if we have fewer messages than the keep threshold
  if (messages.length <= keepRecent) {
    return {
      messages: [...messages],
      removedCount: 0,
      estimatedTokens: estimateTokens(messages),
    };
  }

  const cutIndex = messages.length - keepRecent;
  const removed = messages.slice(0, cutIndex);
  const kept = messages.slice(cutIndex);

  const summaryText = buildSummaryText(removed);

  const summaryMessage: UserMessage = {
    role: "user",
    content: summaryText,
    timestamp: Date.now(),
  };

  const compacted: AgentMessage[] = [summaryMessage, ...kept];

  return {
    messages: compacted,
    removedCount: removed.length,
    estimatedTokens: estimateTokens(compacted),
  };
}
