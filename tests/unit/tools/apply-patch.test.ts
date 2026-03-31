import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApplyPatchTool } from "../../../src/tools/file/apply-patch.js";
import { assembleLocalTools } from "../../../src/tools/tool-assembly.js";

describe("apply_patch tool", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("is included in the default local tool assembly", () => {
    const tools = assembleLocalTools("/tmp");
    expect(tools.some((tool) => tool.name === "apply_patch")).toBe(true);
  });

  it("adds, updates, and deletes files using apply_patch format", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "apply-patch-tool-"));
    tempDirs.push(workspaceDir);
    const existingFile = path.join(workspaceDir, "notes.txt");
    const deletedFile = path.join(workspaceDir, "delete-me.txt");
    await fs.writeFile(existingFile, "hello\nworld\n", "utf8");
    await fs.writeFile(deletedFile, "remove me\n", "utf8");

    const tool = createApplyPatchTool(workspaceDir);
    const result = await tool.execute("call-1", {
      input: `*** Begin Patch
*** Add File: added.txt
+added line
*** Update File: notes.txt
@@
 hello
-world
+general agent sdk
*** Delete File: delete-me.txt
*** End Patch`,
    });

    expect((result.content[0] as { type: "text"; text: string }).text).toContain(
      "Success. Updated the following files:",
    );
    expect(result.details).toEqual({
      summary: {
        added: ["added.txt"],
        modified: ["notes.txt"],
        deleted: ["delete-me.txt"],
      },
    });

    expect(await fs.readFile(path.join(workspaceDir, "added.txt"), "utf8")).toBe("added line\n");
    expect(await fs.readFile(existingFile, "utf8")).toBe("hello\ngeneral agent sdk\n");
    await expect(fs.stat(deletedFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects writes outside the workspace root by default", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "apply-patch-escape-"));
    tempDirs.push(workspaceDir);
    const escapedPath = path.join(path.dirname(workspaceDir), "escaped.txt");

    const tool = createApplyPatchTool(workspaceDir);

    await expect(
      tool.execute("call-2", {
        input: `*** Begin Patch
*** Add File: ../escaped.txt
+owned
*** End Patch`,
      }),
    ).rejects.toThrow(/workspace root|outside workspace|escapes/i);

    await expect(fs.stat(escapedPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
