import { describe, it, expect } from "vitest";
import { AssistantMessageEventStream } from "../../../src/providers/event-stream.js";
import { parseStreamingJson } from "../../../src/providers/json-parse.js";
import { sanitizeSurrogates } from "../../../src/providers/sanitize-unicode.js";

describe("provider utilities", () => {
	it("AssistantMessageEventStream is iterable", () => {
		const stream = new AssistantMessageEventStream();
		expect(stream[Symbol.asyncIterator]).toBeDefined();
	});

	it("parseStreamingJson handles partial JSON", () => {
		expect(parseStreamingJson('{"a": 1')).toEqual({ a: 1 });
		expect(parseStreamingJson("")).toEqual({});
	});

	it("sanitizeSurrogates removes unpaired surrogates", () => {
		expect(sanitizeSurrogates("hello")).toBe("hello");
		expect(sanitizeSurrogates("hello\uD800world")).toBe("helloworld");
	});
});
