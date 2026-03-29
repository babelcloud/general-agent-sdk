import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

const DEFAULT_COUNT = 5;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map<string, { data: string; ts: number }>();

export const webSearchTool: BuiltinTool = {
  definition: {
    name: "web_search",
    description:
      "Search the web using the Brave Search API. Returns titles, URLs, and descriptions. " +
      "Requires BRAVE_SEARCH_API_KEY environment variable.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query string.",
        },
        count: {
          type: "number",
          description: "Number of results to return (1-10). Default: 5.",
        },
        country: {
          type: "string",
          description: "2-letter country code for region-specific results (e.g., 'US', 'DE').",
        },
        freshness: {
          type: "string",
          description: "Filter by time: 'day' (24h), 'week', 'month', or 'year'.",
        },
      },
      required: ["query"],
    },
  },

  async execute(input: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const query = input.query as string;
    const count = Math.min(10, Math.max(1, typeof input.count === "number" ? input.count : DEFAULT_COUNT));
    const country = (input.country as string) || undefined;
    const freshness = (input.freshness as string) || undefined;

    const env = ctx.env ?? process.env;
    const apiKey = env.BRAVE_SEARCH_API_KEY;
    if (!apiKey) {
      return {
        content: JSON.stringify({
          error: "missing_api_key",
          message: "BRAVE_SEARCH_API_KEY environment variable is required for web_search.",
        }),
        isError: true,
      };
    }

    // Check cache
    const cacheKey = `search:${query}:${count}:${country ?? ""}:${freshness ?? ""}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return { content: cached.data };
    }

    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));
    if (country) url.searchParams.set("country", country);
    if (freshness) url.searchParams.set("freshness", freshness);

    const start = Date.now();
    try {
      const resp = await fetch(url.toString(), {
        headers: {
          "Accept": "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!resp.ok) {
        return {
          content: JSON.stringify({ error: "http_error", status: resp.status, message: resp.statusText }),
          isError: true,
        };
      }

      const data = (await resp.json()) as Record<string, unknown>;
      const webResults = (data.web as Record<string, unknown>)?.results as Array<Record<string, unknown>> ?? [];

      const results = webResults.slice(0, count).map((r) => ({
        title: r.title,
        url: r.url,
        description: r.description,
        published: r.page_age ?? r.age ?? null,
      }));

      const payload = JSON.stringify({
        query,
        provider: "brave",
        count: results.length,
        results,
        tookMs: Date.now() - start,
        cached: false,
      });

      cache.set(cacheKey, { data: payload, ts: Date.now() });
      return { content: payload };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: JSON.stringify({ error: "fetch_error", message: msg }), isError: true };
    }
  },
};
