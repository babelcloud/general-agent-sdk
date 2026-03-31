/**
 * Known context window sizes for common model families.
 * These are conservative defaults; the actual context window may be larger.
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic models
  "claude-3-opus": 200_000,
  "claude-3-sonnet": 200_000,
  "claude-3-haiku": 200_000,
  "claude-3.5-sonnet": 200_000,
  "claude-3.5-haiku": 200_000,
  "claude-4-opus": 200_000,
  "claude-4-sonnet": 200_000,
  // OpenAI models
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8_192,
  "gpt-5": 200_000,
  "gpt-5.4": 200_000,
  "o1": 200_000,
  "o1-mini": 128_000,
  "o3": 200_000,
  "o3-mini": 200_000,
  "o4-mini": 200_000,
  // Google models
  "gemini-2.0-flash": 1_048_576,
  "gemini-2.5-pro": 1_048_576,
  "gemini-2.5-flash": 1_048_576,
};

const DEFAULT_CONTEXT_WINDOW = 200_000;

/**
 * Default model reference used when no model is explicitly specified.
 * This is a fallback only — hosts should always provide an explicit modelRef.
 */
export const DEFAULT_MODEL_REF = "openai/gpt-5.4";

/**
 * Resolve the context window size for a model reference string.
 * The modelRef may look like "anthropic/claude-3.5-sonnet" or "openai/gpt-4o" or just "gpt-4o".
 */
export function resolveContextWindow(modelRef: string): number {
  // Strip provider prefix if present (e.g., "anthropic/claude-3.5-sonnet" -> "claude-3.5-sonnet")
  const modelName = modelRef.includes("/") ? modelRef.split("/").pop()! : modelRef;

  // Try exact match first
  if (modelName in MODEL_CONTEXT_WINDOWS) {
    return MODEL_CONTEXT_WINDOWS[modelName];
  }

  // Try prefix match (e.g., "claude-3.5-sonnet-20241022" matches "claude-3.5-sonnet")
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (modelName.startsWith(key)) {
      return value;
    }
  }

  return DEFAULT_CONTEXT_WINDOW;
}
