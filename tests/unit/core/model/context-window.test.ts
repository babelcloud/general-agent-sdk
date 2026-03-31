import { describe, it, expect } from "vitest";
import { resolveContextWindow } from "../../../../src/core/model/context-window.js";

describe("resolveContextWindow", () => {
  it("resolves Claude models to 200K", () => {
    expect(resolveContextWindow("anthropic/claude-3.5-sonnet")).toBe(200_000);
    expect(resolveContextWindow("claude-3.5-sonnet")).toBe(200_000);
    expect(resolveContextWindow("claude-4-opus")).toBe(200_000);
  });

  it("resolves GPT-4o models to 128K", () => {
    expect(resolveContextWindow("openai/gpt-4o")).toBe(128_000);
    expect(resolveContextWindow("gpt-4o-mini")).toBe(128_000);
  });

  it("resolves GPT-5.4 to 200K", () => {
    expect(resolveContextWindow("openai/gpt-5.4")).toBe(200_000);
  });

  it("resolves Gemini models to 1M+", () => {
    expect(resolveContextWindow("google/gemini-2.5-pro")).toBe(1_048_576);
  });

  it("handles provider prefix stripping", () => {
    expect(resolveContextWindow("anthropic/claude-3.5-sonnet")).toBe(
      resolveContextWindow("claude-3.5-sonnet"),
    );
  });

  it("matches model name prefixes for dated variants", () => {
    expect(resolveContextWindow("claude-3.5-sonnet-20241022")).toBe(200_000);
    expect(resolveContextWindow("gpt-4o-2024-08-06")).toBe(128_000);
  });

  it("falls back to 200K for unknown models", () => {
    expect(resolveContextWindow("unknown-model-xyz")).toBe(200_000);
  });
});
