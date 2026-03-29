import fs from "node:fs/promises";
import path from "node:path";
import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types.js";

/**
 * memory_search — search MEMORY.md and memory/*.md files.
 *
 * Uses keyword-based matching (no vector embeddings in SDK mode).
 * For semantic search, configure OPENCLAW_GATEWAY_URL.
 */
export const memorySearchTool: BuiltinTool = {
  definition: {
    name: "memory_search",
    description:
      "Semantically search MEMORY.md + memory/*.md before answering questions about " +
      "prior work, decisions, dates, people, preferences, or todos; returns top snippets with path + lines.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query.",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of results to return.",
        },
        minScore: {
          type: "number",
          description: "Minimum relevance score threshold.",
        },
      },
      required: ["query"],
    },
  },

  async execute(input: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult> {
    const query = input.query as string;
    const maxResults = typeof input.maxResults === "number" ? input.maxResults : 10;
    const memoryDir = ctx.memoryDir;

    if (!memoryDir) {
      return {
        content: JSON.stringify({
          disabled: true,
          message: "Memory directory not configured. Set memoryDir in BuiltinToolContext.",
        }),
      };
    }

    // Try gateway for semantic search
    const env = ctx.env ?? process.env;
    const gatewayUrl = env.OPENCLAW_GATEWAY_URL;
    if (gatewayUrl) {
      try {
        const resp = await fetch(`${gatewayUrl}/memory/search`, {
          method: "POST",
          headers: buildHeaders(env),
          body: JSON.stringify({ query, maxResults, minScore: input.minScore }),
          signal: AbortSignal.timeout(10_000),
        });
        if (resp.ok) {
          return { content: JSON.stringify(await resp.json()) };
        }
      } catch {
        // Fall through to local keyword search
      }
    }

    // Local keyword search
    try {
      const results = await keywordSearch(memoryDir, query, maxResults);
      return {
        content: JSON.stringify({
          query,
          mode: "keyword",
          results,
          count: results.length,
        }),
      };
    } catch (err: unknown) {
      return {
        content: JSON.stringify({
          error: "search_error",
          message: err instanceof Error ? err.message : String(err),
        }),
        isError: true,
      };
    }
  },
};

interface SearchResult {
  path: string;
  line: number;
  snippet: string;
  score: number;
}

async function keywordSearch(
  memoryDir: string,
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  if (keywords.length === 0) return [];

  const results: SearchResult[] = [];
  const files = await collectMemoryFiles(memoryDir);

  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");
      const relPath = path.relative(memoryDir, filePath);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase();
        const matchCount = keywords.filter((kw) => line.includes(kw)).length;
        if (matchCount > 0) {
          const contextStart = Math.max(0, i - 1);
          const contextEnd = Math.min(lines.length, i + 2);
          const snippet = lines.slice(contextStart, contextEnd).join("\n");

          results.push({
            path: relPath,
            line: i + 1,
            snippet: snippet.slice(0, 500),
            score: matchCount / keywords.length,
          });
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Sort by score descending, take top N
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

async function collectMemoryFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  // Check MEMORY.md
  const memoryMd = path.join(dir, "MEMORY.md");
  try {
    await fs.access(memoryMd);
    files.push(memoryMd);
  } catch {
    // not found
  }

  // Check memory/ subdirectory
  const memorySubDir = path.join(dir, "memory");
  try {
    const entries = await fs.readdir(memorySubDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(path.join(memorySubDir, entry.name));
      }
    }
  } catch {
    // not found
  }

  // Also check direct .md files in memoryDir
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "MEMORY.md") {
        const fp = path.join(dir, entry.name);
        if (!files.includes(fp)) files.push(fp);
      }
    }
  } catch {
    // not found
  }

  return files;
}

function buildHeaders(env: Record<string, string | undefined>): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = env.OPENCLAW_GATEWAY_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}
