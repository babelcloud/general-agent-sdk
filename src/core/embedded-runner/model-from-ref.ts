import type { Model } from "../../providers/anthropic-types.js";

/**
 * Build a Model object from a model reference string.
 * Provides sensible defaults for Anthropic models.
 *
 * Resolution order for baseUrl:
 *   1. Explicit `baseUrl` argument
 *   2. `ANTHROPIC_BASE_URL` environment variable
 *   3. Default `https://api.anthropic.com`
 */
export function modelFromRef(modelRef: string, baseUrl?: string): Model<"anthropic-messages"> {
  const isReasoning =
    modelRef.includes("opus") ||
    modelRef.includes("sonnet-4") ||
    modelRef.includes("sonnet-3-7") ||
    modelRef.includes("sonnet-3.7");

  const resolvedBaseUrl =
    baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";

  return {
    id: modelRef,
    name: modelRef,
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: resolvedBaseUrl,
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
