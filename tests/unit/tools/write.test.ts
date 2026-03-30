import { describe, it, expect } from "vitest";
import { createWriteTool } from "../../../src/tools/file/write.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("write tool", () => {
	it("writes a new file", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "write-test-"));
		const filePath = path.join(tmpDir, "output.txt");

		const tool = createWriteTool(tmpDir);
		expect(tool.name).toBe("write");

		const result = await tool.execute("call-1", { path: filePath, content: "hello world\n" });
		const text = (result.content[0] as any).text;
		expect(text).toContain("Successfully wrote");

		const written = await fs.readFile(filePath, "utf-8");
		expect(written).toBe("hello world\n");

		await fs.rm(tmpDir, { recursive: true });
	});

	it("creates parent directories", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "write-test-"));
		const filePath = path.join(tmpDir, "a", "b", "c", "deep.txt");

		const tool = createWriteTool(tmpDir);
		const result = await tool.execute("call-2", { path: filePath, content: "deep content" });
		const text = (result.content[0] as any).text;
		expect(text).toContain("Successfully wrote");

		const written = await fs.readFile(filePath, "utf-8");
		expect(written).toBe("deep content");

		await fs.rm(tmpDir, { recursive: true });
	});
});
