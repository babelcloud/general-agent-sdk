import { afterEach, describe, expect, it, vi } from "vitest";

import { toAnthropicToolDef } from "../../../src/tools/tool-interface.js";
import * as webFetchSsrf from "../../../src/tools/web/ssrf.js";
import { createWebFetchTool } from "../../../src/tools/web/web-fetch.js";

type MockResponse = {
	ok: boolean;
	status: number;
	url?: string;
	statusText?: string;
	headers: { get: (key: string) => string | null };
	text: () => Promise<string>;
};

const SAMPLE_HTML = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Example Article</title>
	</head>
	<body>
		<nav>
			<ul>
				<li><a href="/home">Home</a></li>
				<li><a href="/about">About</a></li>
			</ul>
		</nav>
		<main>
			<article>
				<h1>Example Article</h1>
				<p>Main content starts here with enough words to satisfy readability.</p>
				<p>Second paragraph for a bit more signal.</p>
			</article>
		</main>
		<footer>Footer text</footer>
	</body>
</html>`;

function makeHeaders(map: Record<string, string>): { get: (key: string) => string | null } {
	return {
		get: (key) => map[key.toLowerCase()] ?? null,
	};
}

function markdownResponse(
	body: string,
	url = "https://93.184.216.34/page",
): MockResponse {
	return {
		ok: true,
		status: 200,
		url,
		headers: makeHeaders({ "content-type": "text/markdown; charset=utf-8" }),
		text: async () => body,
	};
}

function firecrawlResponse(
	markdown: string,
	url = "https://93.184.216.34/page",
): MockResponse {
	return {
		ok: true,
		status: 200,
		headers: makeHeaders({ "content-type": "application/json; charset=utf-8" }),
		text: async () =>
			JSON.stringify({
				success: true,
				data: {
					markdown,
					metadata: { title: "Firecrawl Title", sourceURL: url, statusCode: 200 },
				},
			}),
	};
}

function firecrawlErrorResponse(): MockResponse {
	return {
		ok: false,
		status: 403,
		headers: makeHeaders({ "content-type": "application/json; charset=utf-8" }),
		text: async () => JSON.stringify({ success: false, error: "blocked" }),
	};
}

function htmlResponse(body: string, url = "https://93.184.216.34/article"): MockResponse {
	return {
		ok: true,
		status: 200,
		url,
		headers: makeHeaders({ "content-type": "text/html; charset=utf-8" }),
		text: async () => body,
	};
}

function textResponse(body: string, url = "https://93.184.216.34/plain"): MockResponse {
	return {
		ok: true,
		status: 200,
		url,
		headers: makeHeaders({ "content-type": "text/plain; charset=utf-8" }),
		text: async () => body,
	};
}

function installMockFetch(
	impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
	const mockFetch = vi.fn(
		async (input: RequestInfo | URL, init?: RequestInit) => await impl(input, init),
	);
	global.fetch = mockFetch as typeof global.fetch;
	return mockFetch;
}

function createTool(options?: Parameters<typeof createWebFetchTool>[0]) {
	const tool = createWebFetchTool(options);
	if (!tool) {
		throw new Error("Expected web_fetch tool to be available");
	}
	return tool;
}

describe("web_fetch", () => {
	const priorFetch = global.fetch;

	afterEach(() => {
		global.fetch = priorFetch;
		vi.restoreAllMocks();
	});

	it("publishes only markdown and text extract modes", () => {
		vi.spyOn(webFetchSsrf, "validateUrlForFetch").mockResolvedValue({ safe: true });
		const tool = createTool();
		const def = toAnthropicToolDef(tool);
		const serializedSchema = JSON.stringify(def.input_schema);

		expect(serializedSchema).toContain("markdown");
		expect(serializedSchema).toContain("text");
		expect(serializedSchema).not.toContain("\"raw\"");
	});

	it("prefers markdown responses and wraps cf-markdown output", async () => {
		vi.spyOn(webFetchSsrf, "validateUrlForFetch").mockResolvedValue({ safe: true });
		const fetchSpy = installMockFetch(async () => {
			return markdownResponse("# CF Markdown\n\nThis is server-rendered markdown.") as Response;
		});
		const tool = createTool();

		const result = await tool.execute("call", { url: "https://93.184.216.34/cf" });
		const details = result.details as
			| {
					status?: number;
					extractor?: string;
					contentType?: string;
					extractMode?: string;
					text?: string;
			  }
			| undefined;

		expect(fetchSpy).toHaveBeenCalled();
		expect(fetchSpy.mock.calls[0]?.[1]?.headers).toMatchObject({
			Accept: "text/markdown, text/html;q=0.9, */*;q=0.1",
		});
		expect(details).toMatchObject({
			status: 200,
			extractor: "cf-markdown",
			contentType: "text/markdown",
			extractMode: "markdown",
		});
		expect(details?.text).toContain("CF Markdown");
		expect(details?.text).toContain("server-rendered markdown");
		expect(details?.text).toContain("EXTERNAL_UNTRUSTED_CONTENT");
	});

	it("extracts readable html content and exposes wrapped title metadata", async () => {
		vi.spyOn(webFetchSsrf, "validateUrlForFetch").mockResolvedValue({ safe: true });
		installMockFetch(async () => htmlResponse(SAMPLE_HTML) as Response);
		const tool = createTool();

		const result = await tool.execute("call", {
			url: "https://93.184.216.34/article",
			extractMode: "text",
		});
		const details = result.details as
			| {
					extractor?: string;
					contentType?: string;
					title?: string;
					text?: string;
			  }
			| undefined;

		expect(details).toMatchObject({
			extractor: "readability",
			contentType: "text/html",
		});
		expect(details?.title).toContain("Example Article");
		expect(details?.title).toContain("EXTERNAL_UNTRUSTED_CONTENT");
		expect(details?.text).toContain("Main content starts here");
		expect(details?.text).toContain("Second paragraph");
		expect(details?.text).not.toContain("Home");
	});

	it("enforces maxChars after wrapping external content", async () => {
		vi.spyOn(webFetchSsrf, "validateUrlForFetch").mockResolvedValue({ safe: true });
		installMockFetch(async () => textResponse("x".repeat(5_000)) as Response);
		const tool = createTool();

		const result = await tool.execute("call", {
			url: "https://93.184.216.34/long",
			maxChars: 2_000,
		});
		const details = result.details as
			| {
					text?: string;
					truncated?: boolean;
					length?: number;
			  }
			| undefined;

		expect(details?.text?.length).toBeLessThanOrEqual(2_000);
		expect(details?.length).toBe(details?.text?.length);
		expect(details?.truncated).toBe(true);
	});

	it("blocks localhost before fetch and rejects with an SSRF error", async () => {
		vi.spyOn(webFetchSsrf, "validateUrlForFetch").mockResolvedValue({
			safe: false,
			reason: "Blocked hostname: localhost",
		});
		const fetchSpy = installMockFetch(async () => textResponse("should not fetch") as Response);
		const tool = createTool();

		await expect(
			tool.execute("call", { url: "http://localhost/test" }),
		).rejects.toThrow(/blocked hostname|ssrf/i);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("falls back to Firecrawl when readability returns no content", async () => {
		vi.spyOn(webFetchSsrf, "validateUrlForFetch").mockResolvedValue({ safe: true });
		const fetchSpy = installMockFetch(async (input) => {
			const url = String(input);
			if (url.includes("firecrawl.example/v2/scrape")) {
				return firecrawlResponse("firecrawl content") as Response;
			}
			return htmlResponse("<!doctype html><html><head></head><body></body></html>") as Response;
		});
		const tool = createTool({
			firecrawl: {
				apiKey: "firecrawl-test",
				baseUrl: "https://firecrawl.example",
			},
		});

		const result = await tool.execute("call", { url: "https://93.184.216.34/empty" });
		const details = result.details as
			| { extractor?: string; text?: string; contentType?: string; title?: string }
			| undefined;

		expect(details).toMatchObject({
			extractor: "firecrawl",
			contentType: "text/markdown",
		});
		expect(details?.text).toContain("firecrawl content");
		expect(details?.title).toContain("Firecrawl Title");
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("uses Firecrawl when direct fetch returns a non-ok response", async () => {
		vi.spyOn(webFetchSsrf, "validateUrlForFetch").mockResolvedValue({ safe: true });
		installMockFetch(async (input) => {
			const url = String(input);
			if (url.includes("firecrawl.example/v2/scrape")) {
				return firecrawlResponse("firecrawl fallback") as Response;
			}
			return {
				ok: false,
				status: 403,
				statusText: "Forbidden",
				headers: makeHeaders({ "content-type": "text/html; charset=utf-8" }),
				text: async () => "<html><body>blocked</body></html>",
			} as Response;
		});
		const tool = createTool({
			firecrawl: {
				apiKey: "firecrawl-test",
				baseUrl: "https://firecrawl.example",
			},
		});

		const result = await tool.execute("call", { url: "https://93.184.216.34/blocked" });
		const details = result.details as { extractor?: string; text?: string } | undefined;

		expect(details?.extractor).toBe("firecrawl");
		expect(details?.text).toContain("firecrawl fallback");
	});

	it("wraps Firecrawl error details when fallback also fails", async () => {
		vi.spyOn(webFetchSsrf, "validateUrlForFetch").mockResolvedValue({ safe: true });
		installMockFetch(async (input) => {
			const url = String(input);
			if (url.includes("firecrawl.example/v2/scrape")) {
				return firecrawlErrorResponse() as Response;
			}
			throw new Error("network down");
		});
		const tool = createTool({
			firecrawl: {
				apiKey: "firecrawl-test",
				baseUrl: "https://firecrawl.example",
			},
		});

		await expect(
			tool.execute("call", { url: "https://93.184.216.34/firecrawl-error" }),
		).rejects.toThrow(/Firecrawl fetch failed \(403\):/i);
	});

	it("pretty-prints application/json responses", async () => {
		vi.spyOn(webFetchSsrf, "validateUrlForFetch").mockResolvedValue({ safe: true });
		installMockFetch(async () => {
			return {
				ok: true,
				status: 200,
				headers: makeHeaders({ "content-type": "application/json; charset=utf-8" }),
				text: async () => '{"status":"ok","count":3}',
			} as Response;
		});
		const tool = createTool();

		const result = await tool.execute("call", { url: "https://93.184.216.34/json" });
		const details = result.details as { extractor?: string; text?: string } | undefined;

		expect(details?.extractor).toBe("json");
		expect(details?.text).toContain('"status": "ok"');
		expect(details?.text).toContain('"count": 3');
		expect(details?.text).toContain("EXTERNAL_UNTRUSTED_CONTENT");
	});

	it("caps streaming responses by bytes and surfaces a warning", async () => {
		vi.spyOn(webFetchSsrf, "validateUrlForFetch").mockResolvedValue({ safe: true });
		const chunk = new TextEncoder().encode("<html><body><div>hi</div></body></html>");
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.enqueue(chunk);
			},
		});
		installMockFetch(async () => {
			return new Response(stream, {
				status: 200,
				headers: { "content-type": "text/html; charset=utf-8" },
			}) as Response;
		});
		const tool = createTool({ maxResponseBytes: 128 });

		const result = await tool.execute("call", { url: "https://93.184.216.34/stream" });
		const details = result.details as { warning?: string } | undefined;

		expect(details?.warning).toContain("Response body truncated after 32000 bytes.");
	});

	it("strips and wraps html error pages", async () => {
		vi.spyOn(webFetchSsrf, "validateUrlForFetch").mockResolvedValue({ safe: true });
		const html =
			"<!doctype html><html><head><title>Not Found</title></head><body><h1>Not Found</h1><p>missing</p></body></html>";
		installMockFetch(async () => {
			return {
				ok: false,
				status: 404,
				statusText: "Not Found",
				headers: makeHeaders({ "content-type": "text/html; charset=utf-8" }),
				text: async () => html,
			} as Response;
		});
		const tool = createTool();

		await expect(
			tool.execute("call", { url: "https://93.184.216.34/missing" }),
		).rejects.toThrow(/Web fetch failed \(404\):/i);
		await expect(
			tool.execute("call", { url: "https://93.184.216.34/missing" }),
		).rejects.toThrow(/EXTERNAL_UNTRUSTED_CONTENT/);
	});
});
