import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

const DEFAULT_MAX_CHARS = 50_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { data: string; ts: number }>();

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const webFetchTool: BuiltinTool = {
  definition: {
    name: "web_fetch",
    description:
      "Fetch and extract readable content from a URL (HTML → markdown/text). " +
      "Use for lightweight page access without browser automation.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "HTTP or HTTPS URL to fetch.",
        },
        extractMode: {
          type: "string",
          description: 'Extraction mode: "markdown" or "text". Default: "markdown".',
        },
        maxChars: {
          type: "number",
          description: "Maximum characters to return. Default: 50000.",
        },
      },
      required: ["url"],
    },
  },

  async execute(input: Record<string, unknown>, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const rawUrl = input.url as string;
    const extractMode = (input.extractMode as string) || "markdown";
    const maxChars = typeof input.maxChars === "number" ? Math.max(100, input.maxChars) : DEFAULT_MAX_CHARS;

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return { content: JSON.stringify({ error: "invalid_url", message: `Invalid URL: ${rawUrl}` }), isError: true };
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return {
        content: JSON.stringify({ error: "invalid_protocol", message: "Only http/https URLs are supported." }),
        isError: true,
      };
    }

    // Check cache
    const cacheKey = `fetch:${rawUrl}:${extractMode}:${maxChars}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return { content: cached.data };
    }

    const start = Date.now();
    let finalUrl = rawUrl;
    let resp: Response;

    try {
      resp = await fetch(rawUrl, {
        headers: {
          "Accept": "text/markdown, text/html;q=0.9, */*;q=0.1",
          "User-Agent": USER_AGENT,
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      finalUrl = resp.url || rawUrl;

      if (!resp.ok) {
        return {
          content: JSON.stringify({
            error: "http_error",
            status: resp.status,
            url: rawUrl,
            message: resp.statusText,
          }),
          isError: true,
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: JSON.stringify({ error: "fetch_error", message: msg, url: rawUrl }), isError: true };
    }

    try {
      const contentType = resp.headers.get("content-type") || "";
      const rawBody = await resp.text();
      const bodyLength = rawBody.length;

      let text: string;
      let extractor: string;

      if (contentType.includes("application/json")) {
        try {
          text = JSON.stringify(JSON.parse(rawBody), null, 2);
        } catch {
          text = rawBody;
        }
        extractor = "json";
      } else if (contentType.includes("text/markdown")) {
        text = extractMode === "text" ? stripMarkdown(rawBody) : rawBody;
        extractor = "cf-markdown";
      } else if (contentType.includes("text/html")) {
        text = extractFromHtml(rawBody, extractMode);
        extractor = "readability";
      } else {
        text = rawBody;
        extractor = "raw";
      }

      // Truncate
      const truncated = text.length > maxChars;
      if (truncated) {
        text = text.slice(0, maxChars) + "\n...(truncated)";
      }

      const payload = JSON.stringify({
        url: rawUrl,
        finalUrl,
        status: resp.status,
        contentType: contentType.split(";")[0].trim(),
        extractMode,
        extractor,
        truncated,
        length: text.length,
        rawLength: bodyLength,
        fetchedAt: new Date().toISOString(),
        tookMs: Date.now() - start,
        text,
        cached: false,
      });

      cache.set(cacheKey, { data: payload, ts: Date.now() });
      return { content: payload };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: JSON.stringify({ error: "extract_error", message: msg }), isError: true };
    }
  },
};

/**
 * Basic HTML → text/markdown extraction without external dependencies.
 * Strips tags, decodes entities, normalizes whitespace.
 */
function extractFromHtml(html: string, mode: string): string {
  // Remove script, style, and other non-content tags
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  if (mode === "markdown") {
    // Convert some HTML to markdown
    text = text
      .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
      .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
      .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
      .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n")
      .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n")
      .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n")
      .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
      .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**")
      .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*")
      .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*")
      .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
      .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n")
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n")
      .replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, "\n$1\n");
  }

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

  // Normalize whitespace
  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  return text;
}

function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}
