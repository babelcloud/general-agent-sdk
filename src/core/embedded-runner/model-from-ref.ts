import type { Model } from "../../providers/anthropic-types.js";

/**
 * Build a Model object from a model reference string.
 * Provides sensible defaults for Anthropic models.
 */
export function modelFromRef(modelRef: string, baseUrl?: string): Model<"anthropic-messages"> {
  const isReasoning =
    modelRef.includes("opus") ||
    modelRef.includes("sonnet-4") ||
    modelRef.includes("sonnet-3-7") ||
    modelRef.includes("sonnet-3.7");

  return {
    id: modelRef,
    name: modelRef,
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: baseUrl ?? "https://api.anthropic.com",
    reasoning: isReasoning,
    input: ["text", "image"],
    cost: {
      input: 3,    // $/million tokens (default, not exact)
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    },
    contextWindow: 200_000,
    maxTokens: 16384,
  };
}
