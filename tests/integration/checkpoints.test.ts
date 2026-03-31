import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createGeneralAgentSdk, type GeneralAgentSession } from "../../src/index.js";

async function createSessionFixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "general-agent-sdk-checkpoints-"));
  const sessionFile = path.join(root, "state", "session.jsonl");

  const sdk = await createGeneralAgentSdk({
    workspaceDir: root,
    stateDir: path.join(root, "state"),
    agentDir: path.join(root, "agent"),
    profileId: "default",
    pluginMode: "disabled",
    logger: {
      onDebug() {},
      onInfo() {},
      onWarn() {},
      onError() {},
    },
    sessionStore: {
      async load() {
        return null;
      },
      async save() {},
      async resolveSessionFile() {
        return sessionFile;
      },
    },
  });

  const session = sdk.createSession({
    identity: {
      mode: "general",
      sessionId: "sess-general",
      sessionKey: "host:default:general",
    },
    systemPrompt: "Stay idle.",
    modelRef: "openai/gpt-5.4",
    sessionFile,
  });

  const localTools = (session as any).localTools as Array<{
    name: string;
    execute: (callId: string, params: unknown) => Promise<unknown>;
  }>;

  return { root, sdk, session, localTools };
}

describe("checkpoints", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })),
    );
  });

  it("records and restores a checkpoint for a newly written file", async () => {
    const { root, sdk, session, localTools } = await createSessionFixture();
    tempDirs.push(root);
    const write = localTools.find((tool) => tool.name === "write");
    if (!write) {
      throw new Error("Expected write tool");
    }
    const target = path.join(root, "notes.txt");

    await write.execute("call-write", {
      path: target,
      content: "hello world\n",
    });

    expect(await fsp.readFile(target, "utf8")).toBe("hello world\n");

    const checkpoints = await (session as GeneralAgentSession).listCheckpoints();
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]).toMatchObject({
      toolName: "write",
      callId: "call-write",
      files: [{ path: "notes.txt", existedBefore: false }],
    });

    await (session as GeneralAgentSession).restoreCheckpoint(checkpoints[0]!.id);
    expect(fs.existsSync(target)).toBe(false);

    await sdk.shutdown();
  });

  it("records and restores checkpoints for edit and apply_patch mutations", async () => {
    const { root, sdk, session, localTools } = await createSessionFixture();
    tempDirs.push(root);
    const edit = localTools.find((tool) => tool.name === "edit");
    const applyPatch = localTools.find((tool) => tool.name === "apply_patch");
    if (!edit || !applyPatch) {
      throw new Error("Expected edit/apply_patch tools");
    }

    const editedFile = path.join(root, "edited.txt");
    const removedFile = path.join(root, "remove.txt");
    await fsp.writeFile(editedFile, "alpha\nbeta\n", "utf8");
    await fsp.writeFile(removedFile, "remove me\n", "utf8");

    await edit.execute("call-edit", {
      path: editedFile,
      oldText: "beta",
      newText: "gamma",
    });
    expect(await fsp.readFile(editedFile, "utf8")).toBe("alpha\ngamma\n");

    let checkpoints = await (session as GeneralAgentSession).listCheckpoints();
    expect(checkpoints[0]).toMatchObject({
      toolName: "edit",
      callId: "call-edit",
      files: [{ path: "edited.txt", existedBefore: true }],
    });
    await (session as GeneralAgentSession).restoreCheckpoint(checkpoints[0]!.id);
    expect(await fsp.readFile(editedFile, "utf8")).toBe("alpha\nbeta\n");

    await applyPatch.execute("call-patch", {
      input: `*** Begin Patch
*** Add File: added.txt
+added line
*** Update File: edited.txt
@@
 alpha
-beta
+delta
*** Delete File: remove.txt
*** End Patch`,
    });

    expect(await fsp.readFile(editedFile, "utf8")).toBe("alpha\ndelta\n");
    expect(await fsp.readFile(path.join(root, "added.txt"), "utf8")).toBe("added line\n");
    await expect(fsp.stat(removedFile)).rejects.toMatchObject({ code: "ENOENT" });

    checkpoints = await (session as GeneralAgentSession).listCheckpoints();
    expect(checkpoints[0]).toMatchObject({
      toolName: "apply_patch",
      callId: "call-patch",
      files: [
        { path: "added.txt", existedBefore: false },
        { path: "edited.txt", existedBefore: true },
        { path: "remove.txt", existedBefore: true },
      ],
    });

    await (session as GeneralAgentSession).restoreCheckpoint(checkpoints[0]!.id);
    expect(await fsp.readFile(editedFile, "utf8")).toBe("alpha\nbeta\n");
    expect(fs.existsSync(path.join(root, "added.txt"))).toBe(false);
    expect(await fsp.readFile(removedFile, "utf8")).toBe("remove me\n");

    await sdk.shutdown();
  });
});
