import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createGeneralAgentSdk } from "../../src/index.js";

describe("sdk tool configuration", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes public web tool options through sdk -> session -> local tool assembly", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-tool-config-"));
    tempDirs.push(root);
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
      tools: {
        web: {
          fetch: {
            firecrawl: {
              apiKey: "firecrawl-test",
              baseUrl: "https://firecrawl.example",
            },
          },
          search: {
            apiKey: "brave-test",
          },
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

    const localTools = (session as any).localTools as Array<{ name: string }>;

    expect(localTools.some((tool) => tool.name === "web_fetch")).toBe(true);
    expect(localTools.some((tool) => tool.name === "web_search")).toBe(true);

    await sdk.shutdown();
  });
});
