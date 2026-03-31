import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-pack-smoke-"));
const tarballDir = path.join(tempRoot, "tarballs");
const consumerRoot = path.join(tempRoot, "consumer");

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      npm_config_yes: "true",
    },
  });
}

function resolvePnpmBin() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function resolveNodeBin() {
  return process.execPath;
}

fs.mkdirSync(tarballDir, { recursive: true });
fs.mkdirSync(consumerRoot, { recursive: true });

run(resolvePnpmBin(), ["pack", "--pack-destination", tarballDir], repoRoot);

const tarballs = fs
  .readdirSync(tarballDir)
  .filter((name) => name.endsWith(".tgz"))
  .sort();

if (tarballs.length !== 1) {
  throw new Error(`expected exactly one tarball, received ${tarballs.length}`);
}

const tarballPath = path.join(tarballDir, tarballs[0]);
fs.writeFileSync(
  path.join(consumerRoot, "package.json"),
  JSON.stringify(
    {
      name: "general-agent-sdk-smoke-consumer",
      private: true,
      type: "module",
    },
    null,
    2,
  ) + "\n",
  "utf-8",
);

run(resolvePnpmBin(), ["add", tarballPath], consumerRoot);

const smokeScriptPath = path.join(consumerRoot, "smoke.mjs");
fs.writeFileSync(
  smokeScriptPath,
  `
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createGeneralAgentSdk,
} from "general-agent-sdk";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "general-agent-sdk-installed-"));
const sessionFile = path.join(root, "profile", "providers", "general-agent", "transcripts", "general.jsonl");
const rawEventLogPath = path.join(root, "profile", "providers", "general-agent", "raw-stream", "events.jsonl");
const logEvents = [];
const rawEvents = [];

const sdk = await createGeneralAgentSdk({
  workspaceDir: path.join(root, "workspace"),
  stateDir: path.join(root, "profile"),
  agentDir: path.join(root, "profile", "providers", "general-agent", "embedded"),
  profileId: "default",
  pluginMode: "allowlisted",
  enabledPluginIds: ["builtin-web-search"],
  logger: {
    onDebug(event) { logEvents.push(event); },
    onInfo(event) { logEvents.push(event); },
    onWarn(event) { logEvents.push(event); },
    onError(event) { logEvents.push(event); },
    onRawStreamEvent(event) { rawEvents.push(event); },
  },
  sessionStore: {
    async load() { return null; },
    async save() {},
    async resolveSessionFile() { return sessionFile; },
  },
  hostedTools: [
    {
      name: "gateway",
      description: "forbidden in embedded mode",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "finish",
      description: "allowed in embedded mode",
      inputSchema: { type: "object", properties: {} },
    },
  ],
});

const session = sdk.createSession({
  identity: {
    mode: "general",
    sessionId: "sess-general",
    sessionKey: "host:default:general",
  },
  systemPrompt: "Use the finish tool immediately.",
  modelRef: "openai/gpt-5.4",
  sessionFile,
  rawEventLogPath,
});

// Verify that a denied tool (gateway) is NOT exposed: without a valid API key
// and without a matching allowed hosted tool, the SDK throws a hard error per §16.
let deniedTurnError = null;
try {
  const deniedTurn = [];
  for await (const event of session.streamTurn({
    role: "user",
    content: [{ type: "text", text: "gateway now" }],
  })) {
    deniedTurn.push(event);
    if (event.kind === "hosted_tool_call") {
      throw new Error("denied tool was exposed from packaged sdk");
    }
  }
} catch (err) {
  deniedTurnError = err;
}

if (!deniedTurnError || !deniedTurnError.message.includes("No API key provided")) {
  throw new Error("expected hard error for denied tool turn without API key, got: " + String(deniedTurnError?.message ?? "no error"));
}

const firstTurn = [];
for await (const event of session.streamTurn({
  role: "user",
  content: [{ type: "text", text: "finish now" }],
})) {
  firstTurn.push(event);
}

const hosted = firstTurn.find((event) => event.kind === "hosted_tool_call");
if (!hosted) {
  throw new Error("packaged sdk did not emit hosted_tool_call");
}

const resumed = [];
for await (const event of session.submitHostedToolResult({
  callId: hosted.callId,
  output: { ok: true },
})) {
  resumed.push(event);
}

if (!resumed.some((event) => event.kind === "turn_complete")) {
  throw new Error("packaged sdk did not complete resumed turn");
}

if (!fs.existsSync(sessionFile)) {
  throw new Error("packaged sdk did not write transcript");
}

if (!fs.existsSync(rawEventLogPath)) {
  throw new Error("packaged sdk did not write raw stream log");
}

const promptLogs = logEvents.filter((event) => event.category === "system_prompt");
if (promptLogs.length !== 2) {
  throw new Error(\`expected exactly two canonical system prompt logs across two top-level turns, received \${promptLogs.length}\`);
}

if (!rawEvents.length) {
  throw new Error("packaged sdk did not emit raw events");
}

await sdk.shutdown();
console.log("packaged smoke passed");
`,
  "utf-8",
);

run(resolveNodeBin(), [smokeScriptPath], consumerRoot);
console.log(`smoke install verified via ${tarballPath}`);
