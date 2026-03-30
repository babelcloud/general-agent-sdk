import { describe, it, expect } from "vitest";
import { createEditTool } from "../../../src/tools/file/edit.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("edit tool", () => {
	it("replaces exact text", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "edit-test-"));
		const filePath = path.join(tmpDir, "test.txt");
		await fs.writeFile(filePath, "hello world\nfoo bar\n");

		const tool = createEditTool(tmpDir);
		expect(tool.name).toBe("edit");

		const result = await tool.execute("call-1", {
			path: filePath,
			oldText: "foo bar",
			newText: "baz qux",
		});
		const text = (result.content[0] as any).text;
		expect(text).toContain("Successfully replaced");

		const content = await fs.readFile(filePath, "utf-8");
		expect(content).toContain("baz qux");
		expect(content).not.toContain("foo bar");

		await fs.rm(tmpDir, { recursive: true });
	});

	it("returns error when text not found", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "edit-test-"));
		const filePath = path.join(tmpDir, "test.txt");
		await fs.writeFile(filePath, "hello world\n");

		const tool = createEditTool(tmpDir);
		const result = await tool.execute("call-2", {
			path: filePath,
			oldText: "nonexistent text",
			newText: "replacement",
		});
		const text = (result.content[0] as any).text;
		expect(text).toContain("Error:");
		expect(text).toContain("Could not find");

		await fs.rm(tmpDir, { recursive: true });
	});

	it("returns error when file not found", async () => {
		const tool = createEditTool("/tmp");
		const result = await tool.execute("call-3", {
			path: "/tmp/nonexistent-edit-xyz.txt",
			oldText: "a",
			newText: "b",
		});
		const text = (result.content[0] as any).text;
		expect(text).toContain("Error:");
	});
});
