import { describe, it, expect } from "vitest";
import { createReadTool } from "../../../src/tools/file/read.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("read tool", () => {
	it("reads a text file", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "read-test-"));
		const filePath = path.join(tmpDir, "test.txt");
		await fs.writeFile(filePath, "line1\nline2\nline3\n");

		const tool = createReadTool(tmpDir);
		expect(tool.name).toBe("read");

		const result = await tool.execute("call-1", { path: filePath });
		const text = result.content[0];
		expect(text.type).toBe("text");
		expect((text as any).text).toContain("line1");
		expect((text as any).text).toContain("line3");

		await fs.rm(tmpDir, { recursive: true });
	});

	it("returns error for non-existent file", async () => {
		const tool = createReadTool("/tmp");
		const result = await tool.execute("call-2", { path: "/tmp/nonexistent-file-xyz.txt" });
		const text = (result.content[0] as any).text;
		expect(text).toContain("Error:");
	});

	it("supports offset/limit paging", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "read-test-"));
		const filePath = path.join(tmpDir, "lines.txt");
		const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
		await fs.writeFile(filePath, lines);

		const tool = createReadTool(tmpDir);
		const result = await tool.execute("call-3", { path: filePath, offset: 10, limit: 5 });
		const text = (result.content[0] as any).text;
		expect(text).toContain("line 10");
		expect(text).toContain("line 14");
		expect(text).toContain("Showing lines 10-14");

		await fs.rm(tmpDir, { recursive: true });
	});
});
