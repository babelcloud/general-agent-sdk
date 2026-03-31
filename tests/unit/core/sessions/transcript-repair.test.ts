import { describe, it, expect } from "vitest";
import { sanitizeMessages } from "../../../../src/core/sessions/transcript-repair.js";

describe("sanitizeMessages", () => {
  it("returns empty array unchanged", () => {
    expect(sanitizeMessages([])).toEqual([]);
  });

  it("returns valid alternating messages unchanged", () => {
    const msgs = [
      { role: "user", content: "hello", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "hi" }], stopReason: "end" },
    ] as any[];
    expect(sanitizeMessages(msgs)).toEqual(msgs);
  });

  it("removes orphaned tool results that don't follow an assistant message", () => {
    const msgs = [
      { role: "toolResult", toolCallId: "t1", toolName: "x", content: "result" },
      { role: "user", content: "hello", timestamp: 1 },
    ] as any[];
    const result = sanitizeMessages(msgs);
    expect(result).toHaveLength(1);
    expect((result[0] as any).role).toBe("user");
  });

  it("keeps tool results that follow an assistant message", () => {
    const msgs = [
      { role: "user", content: "hello", timestamp: 1 },
      { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "x" }], stopReason: "tool_use" },
      { role: "toolResult", toolCallId: "t1", toolName: "x", content: "result" },
    ] as any[];
    const result = sanitizeMessages(msgs);
    expect(result).toHaveLength(3);
  });

  it("keeps consecutive tool results after an assistant message", () => {
    const msgs = [
      { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "a" }, { type: "toolCall", id: "t2", name: "b" }], stopReason: "tool_use" },
      { role: "toolResult", toolCallId: "t1", toolName: "a", content: "r1" },
      { role: "toolResult", toolCallId: "t2", toolName: "b", content: "r2" },
    ] as any[];
    const result = sanitizeMessages(msgs);
    expect(result).toHaveLength(3);
  });
});
