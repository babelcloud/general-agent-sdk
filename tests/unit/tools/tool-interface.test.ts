import { describe, it, expect } from "vitest";
import { z } from "zod";

import {
  type OpenClawTool,
  type OpenClawToolResult,
  toAnthropicToolDef,
} from "../../../src/tools/tool-interface.js";
import { textResult, jsonResult } from "../../../src/tools/shared/tool-result.js";

describe("OpenClawTool interface", () => {
  const mockTool: OpenClawTool = {
    name: "test_tool",
    description: "A test tool",
    parameters: z.object({ input: z.string() }),
    execute: async (_callId, _params) => textResult("ok"),
  };

  it("converts to Anthropic tool definition", () => {
    const def = toAnthropicToolDef(mockTool);
    expect(def.name).toBe("test_tool");
    expect(def.description).toBe("A test tool");
    expect(def.input_schema).toHaveProperty("type", "object");
    expect(def.input_schema).toHaveProperty("properties");
    expect((def.input_schema as any).properties.input).toHaveProperty("type", "string");
  });
});

describe("tool result helpers", () => {
  it("textResult produces correct structure", () => {
    const result = textResult("hello");
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({ type: "text", text: "hello" });
  });

  it("jsonResult stringifies object", () => {
    const result = jsonResult({ status: "ok", count: 3 });
    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(JSON.parse(text)).toEqual({ status: "ok", count: 3 });
  });
});
