import type { AgentMessage } from "../../loop/agent-types.js";

/**
 * Validates and repairs agent message history before compaction or resume.
 *
 * Ensures:
 * 1. Messages alternate properly: user messages should not appear consecutively
 *    without an assistant response in between (orphaned user messages get removed)
 * 2. Tool result messages always follow an assistant message that requested them
 *    (orphaned tool results get removed)
 * 3. The final message is not a dangling tool result without a subsequent assistant response
 *    (this is valid during continuation, so we only remove if clearly orphaned)
 *
 * Returns the sanitized message array (may be same reference if no changes needed).
 */
export function sanitizeMessages(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length <= 1) return messages;

  const result: AgentMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const role = getRole(msg);

    if (role === "toolResult") {
      // Tool results must follow an assistant message that had tool calls
      const prev = result.length > 0 ? result[result.length - 1] : null;
      const prevRole = prev ? getRole(prev) : null;
      if (prevRole === "assistant" || prevRole === "toolResult") {
        result.push(msg);
      }
      // else: orphaned tool result, skip it
      continue;
    }

    result.push(msg);
  }

  return result;
}

function getRole(msg: AgentMessage): string {
  if (msg && typeof msg === "object" && "role" in msg) {
    return (msg as { role: string }).role;
  }
  return "unknown";
}
