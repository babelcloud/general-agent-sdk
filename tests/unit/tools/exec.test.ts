import { describe, it, expect } from "vitest";
import { createExecTool } from "../../../src/tools/exec/exec.js";

describe("exec tool", () => {
	it("has correct name", () => {
		const tool = createExecTool(process.cwd());
		expect(tool.name).toBe("exec");
	});

	it("executes echo command", async () => {
		const tool = createExecTool(process.cwd());
		const result = await tool.execute("call-1", { command: "echo hello" });
		const text = (result.content[0] as any).text;
		expect(text).toContain("hello");
	});

	it("respects timeout", async () => {
		const tool = createExecTool(process.cwd());
		const result = await tool.execute("call-2", { command: "sleep 10", timeout: 1 });
		const text = (result.content[0] as any).text;
		expect(text).toMatch(/timed out/i);
	}, 10000);

	it("reports non-zero exit code", async () => {
		const tool = createExecTool(process.cwd());
		const result = await tool.execute("call-3", { command: "exit 42" });
		const text = (result.content[0] as any).text;
		expect(text).toContain("42");
	});
});
