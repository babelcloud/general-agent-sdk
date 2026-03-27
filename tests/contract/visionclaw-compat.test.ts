import { describe, expect, it } from "vitest";
import {
  createVisionClawSessionAdapter,
  normalizeOpenClawEventForVisionClaw,
  type VisionClawCompatSessionLike,
  type VisionClawCompatStreamMessage,
} from "../../src/compat/visionclaw/index.js";

describe("compat/visionclaw contract", () => {
  it("exports a VisionClaw-compatible normalizer without renaming tools", () => {
    const normalized = normalizeOpenClawEventForVisionClaw({
      kind: "tool_call",
      callId: "call-1",
      toolName: "exec",
      input: { command: "pwd" },
    });

    expect(normalized).toEqual({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            name: "exec",
            input: { command: "pwd" },
            id: "call-1",
          },
        ],
      },
    });

    expect(typeof createVisionClawSessionAdapter).toBe("function");

    type _Session = VisionClawCompatSessionLike;
    type _Message = VisionClawCompatStreamMessage;
    void (0 as unknown as _Session);
    void (0 as unknown as _Message);
  });
});
