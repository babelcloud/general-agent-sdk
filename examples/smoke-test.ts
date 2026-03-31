import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createGeneralAgentSdk, type GeneralAgentStreamEvent } from "../src/index.js";

async function collect(
  stream: AsyncIterable<GeneralAgentStreamEvent>,
): Promise<GeneralAgentStreamEvent[]> {
  const events: GeneralAgentStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-smoke-"));
const sessionFile = path.join(root, "state", "sessions", "smoke.jsonl");

const sdk = await createGeneralAgentSdk({
  workspaceDir: path.join(root, "workspace"),
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
  hostedTools: [
    {
      name: "finish",
      description: "Mark task complete",
      inputSchema: { type: "object", properties: {} },
    },
  ],
});

const sessionId = randomUUID();
const session = sdk.createSession({
  identity: {
    mode: "general",
    sessionId,
    sessionKey: `host:default:${sessionId}`,
  },
  systemPrompt: "Use the finish tool immediately.",
  modelRef: "openai/gpt-5.4",
  sessionFile,
});

const firstTurn = await collect(
  session.streamTurn({
    role: "user",
    content: [{ type: "text", text: "finish now" }],
  }),
);

const hosted = firstTurn.find(
  (event): event is Extract<GeneralAgentStreamEvent, { kind: "hosted_tool_call" }> =>
    event.kind === "hosted_tool_call",
);

if (!hosted) {
  throw new Error("expected hosted_tool_call from smoke turn");
}

const resumed = await collect(
  session.submitHostedToolResult({
    callId: hosted.callId,
    output: { ok: true },
  }),
);

if (!resumed.some((event) => event.kind === "turn_complete")) {
  throw new Error("expected turn_complete after hosted tool result");
}

await sdk.shutdown();
console.log("smoke-test.ts: ok");
