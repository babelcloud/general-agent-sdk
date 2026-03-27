# OpenClaw Agent SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone `openclaw-agent-sdk` repository and integrate it into VisionClaw as a third engine backend without losing VisionClaw-owned session state, same-session cross-engine continuity, tool-call semantics, host-rooted logging, or cross-repo traceability.

**Architecture:** Work happens in two repositories with a strict dependency order. First, bootstrap and implement a session-first SDK in `/Users/apple/programme/funny_projects/openclaw_agent_sdk` by extracting the minimum embedded OpenClaw runner/kernel plus explicit persistence, logger, and hosted-tool seams. Second, after the SDK SHA is pushed to `babelcloud/openclaw-agent-sdk`, wire VisionClaw to it through an engine-discriminated provider bridge that normalizes SDK events into the existing `AgentStreamMessage`, `logger.ts`, and `session.json` contracts.

**Tech Stack:** TypeScript, Node.js `>=22.14.0` for SDK and `24.12.0` for VisionClaw host, pnpm, vitest, zod, extracted OpenClaw embedded runner files, VisionClaw session/provider abstractions, git submodules.

**Execution note:** Keep the package build graph restricted to `src/**/*`. Tests and `vitest.config.ts` must not be compiled under `rootDir: "src"`, and provenance-tracked `src/upstream/openclaw/**/*` may remain outside the compile graph until the required dependency closure is wrapped behind SDK-owned core modules.

---

## File Map

### SDK repository: `/Users/apple/programme/funny_projects/openclaw_agent_sdk`

- `package.json`: package metadata, scripts, exports, engine constraints.
- `tsconfig.json`: TypeScript build for ESM + declarations.
- `vitest.config.ts`: SDK test runner.
- `manifests/upstream-provenance.json`: machine-readable record of extracted upstream files.
- `scripts/sync-from-openclaw.mjs`: controlled upstream copy/sync command.
- `scripts/verify-upstream-snapshot.mjs`: provenance validation command.
- `src/index.ts`: only top-level package entry.
- `src/public/types.ts`: SDK public types.
- `src/public/events.ts`: normalized `OpenClawStreamEvent` contract.
- `src/public/persistence.ts`: `OpenClawSessionStoreAdapter` contract.
- `src/public/host-tools.ts`: hosted-tool definitions and resume payload contracts.
- `src/public/session.ts`: public `OpenClawAgentSession` interface.
- `src/public/sdk.ts`: `createOpenClawAgentSdk()` public factory.
- `src/core/embedded-runner/sdk-factory.ts`: private bootstrap wiring.
- `src/core/embedded-runner/sdk-session.ts`: session implementation wrapping upstream embedded runs.
- `src/core/normalization/upstream-events.ts`: upstream run result -> normalized SDK event mapping.
- `src/core/logging/host-logger.ts`: canonical host logger sink + raw stream writer adapter.
- `src/core/sessions/session-store.ts`: host persistence + transcript path glue.
- `src/core/plugins/plugin-runtime.ts`: process-global allowlisted plugin bootstrap.
- `src/core/tools/tool-policy.ts`: embedded-mode allow/deny tool policy.
- `src/upstream/openclaw/**`: extracted subset only, copied by script and tracked by provenance manifest.
- `tests/contract/public-api.test.ts`: public export shape.
- `tests/contract/upstream-provenance.test.ts`: provenance/manifest correctness.
- `tests/integration/standalone-session.test.ts`: standalone stream turn + hosted-tool round-trip.
- `tests/integration/persistence-and-logging.test.ts`: host-controlled path and canonical logging.
- `tests/integration/plugins-and-tools.test.ts`: allowlisted plugins + tool deny profile.
- `tests/fixtures/upstream-phase1-files.json`: exact extraction allowlist for phase-1 kernel files.

### VisionClaw repository: `/Users/apple/programme/funny_projects/visionclaw_repo`

- `src/config/types.ts`: engine-discriminated config schema.
- `src/config/index.ts`: config migration + OpenClaw branch loading.
- `src/agent/providers/engine.ts`: engine selection helper.
- `src/agent/providers/openclaw/sdk-loader.ts`: lazy SDK import boundary.
- `src/agent/providers/openclaw/sdk-factory.ts`: SDK singleton bootstrap + logger injection.
- `src/agent/providers/openclaw/event-normalizer.ts`: `OpenClawStreamEvent` -> `AgentStreamMessage`.
- `src/agent/providers/openclaw/persistence.ts`: VisionClaw profile state -> SDK persistence adapter.
- `src/agent/providers/openclaw/host-tools.ts`: VisionClaw hosted tool bridge and resume helpers.
- `src/agent/providers/openclaw/session.ts`: `AgentSessionLike` wrapper for SDK sessions.
- `src/agent/conversation-journal.ts`: host-owned canonical continuity journal and cross-engine resume prelude builder.
- `src/agent/providers/session-types.ts`: optional type additions for the OpenClaw provider bridge.
- `src/agent/providers/client-factory.ts`: engine labels and legacy model/provider compatibility helpers.
- `src/agent/session-manager.ts`: engine-based session construction instead of Claude/OpenAI binary split.
- `src/agent/runtime-surface.ts`: capability description extended for OpenClaw engine.
- `src/agent/loop.ts`: async SDK bootstrap before `SessionManager` creation.
- `src/reconfigure.ts`: engine-first reconfiguration flow.
- `package.json`: publish manifest, build scripts, staged vendor SDK packaging.
- `scripts/setup-openclaw-shim.mjs`: retained for shim, extended to stage packaged SDK runtime.
- `scripts/stage-openclaw-agent-sdk.mjs`: build/copy the SDK runtime into publishable artifacts.
- `gui/package.json`: GUI-side dependency on staged runtime remains valid after packaging.
- `.gitmodules`: submodule registration for `packages/openclaw-agent-sdk`.
- `packages/openclaw-agent-sdk`: git submodule pointing at pushed BabelCloud SDK SHA.
- `tests/unit/config/types.test.ts`: engine schema and migration.
- `tests/unit/config/index.test.ts`: config loading/migration.
- `tests/unit/agent/runtime-surface.test.ts`: engine capability surface.
- `tests/unit/reconfigure.test.ts`: reconfigure CLI flow.
- `tests/unit/agent/openclaw-event-normalizer.test.ts`: event mapping and host log parity.
- `tests/unit/agent/openclaw-sdk-loader.test.ts`: lazy import + packaged-runtime resolution.
- `tests/unit/agent/conversation-journal.test.ts`: canonical continuity journal, per-engine cursor, and resume-prelude behavior.
- `tests/integration/session-manager.test.ts`: engine-based session creation and dual-session behavior.
- `tests/integration/stream-handler.test.ts`: normalized tool/result behavior.
- `tests/integration/openclaw-provider.test.ts`: OpenClaw provider end-to-end host integration.
- `tests/integration/engine-switch-continuity.test.ts`: switching engines mid-session preserves the logical conversation without raw transcript sharing.
- `tests/integration/openclaw-packaging.test.ts`: packaged vendor runtime availability.

### Cross-repo sequencing rule

- Tasks 1 through 5 happen only in `/Users/apple/programme/funny_projects/openclaw_agent_sdk`.
- Task 6 must push the SDK SHA before VisionClaw code starts consuming it.
- Tasks 7 through 9 happen in `/Users/apple/programme/funny_projects/visionclaw_repo` against the pushed SDK SHA.

### Task 1: Bootstrap The SDK Repository

**Files:**
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/package.json`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/tsconfig.json`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/vitest.config.ts`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/index.ts`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/public/types.ts`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/public/events.ts`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/public/persistence.ts`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/public/host-tools.ts`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/public/session.ts`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/public/sdk.ts`
- Test: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/contract/public-api.test.ts`

- [ ] **Step 1: Write the failing public API contract test**

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/contract/public-api.test.ts
import { describe, expect, it } from "vitest";
import {
  createOpenClawAgentSdk,
  type OpenClawAgentSdk,
  type OpenClawAgentSdkOptions,
  type OpenClawAgentSession,
  type OpenClawSessionParams,
  type OpenClawStreamEvent,
} from "../../src/index.js";

describe("public API", () => {
  it("exports the session-first SDK surface", () => {
    expect(typeof createOpenClawAgentSdk).toBe("function");

    type _Sdk = OpenClawAgentSdk;
    type _Options = OpenClawAgentSdkOptions;
    type _Session = OpenClawAgentSession;
    type _SessionParams = OpenClawSessionParams;
    type _StreamEvent = OpenClawStreamEvent;

    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run:

```bash
cd /Users/apple/programme/funny_projects/openclaw_agent_sdk
pnpm exec vitest run tests/contract/public-api.test.ts
```

Expected: FAIL with `Cannot find module '../../src/index.js'` or equivalent missing-file/import error.

- [ ] **Step 3: Create the package/build/test skeleton and public type surface**

```json
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/package.json
{
  "name": "openclaw-agent-sdk",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "engines": {
    "node": ">=22.14.0"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "check": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:contract": "vitest run tests/contract",
    "test:integration": "vitest run tests/integration"
  },
  "dependencies": {
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^4.0.18"
  }
}
```

```json
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/public/types.ts
export interface OpenClawLogEvent {
  category:
    | "system_prompt"
    | "tool_call"
    | "tool_result"
    | "assistant"
    | "system"
    | "provider_debug";
  message: string;
  data?: Record<string, unknown>;
}

export interface OpenClawHostLogger {
  onDebug(event: OpenClawLogEvent): void;
  onInfo(event: OpenClawLogEvent): void;
  onWarn(event: OpenClawLogEvent): void;
  onError(event: OpenClawLogEvent): void;
  onRawStreamEvent?(event: Record<string, unknown>): void;
}

export interface OpenClawSessionIdentity {
  mode: "general" | "coding";
  sessionId: string;
  sessionKey: string;
}

export interface OpenClawSessionParams {
  identity: OpenClawSessionIdentity;
  systemPrompt: string;
  modelRef: string;
  sessionFile: string;
  authProfileId?: string;
  rawEventLogPath?: string;
}

export interface OpenClawTurnInput {
  role: "user";
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; mimeType: string; data: string }
    | { type: "tool_result"; callId: string; output: unknown; isError?: boolean }
  >;
}

export interface OpenClawUsageSnapshot {
  usedInputTokens: number;
  contextWindow: number;
  usedPct: number;
  capturedAtMs: number;
}

export interface OpenClawCompactionOptions {
  usedPctThreshold?: number;
  cooldownMs?: number;
}

export interface OpenClawCurrentQueryLike {
  mcpServerStatus?(): Promise<unknown>;
  toggleMcpServer?(serverName: string, enabled: boolean): Promise<void>;
}
```

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/public/events.ts
import type { OpenClawUsageSnapshot } from "./types.js";

export type OpenClawStreamEvent =
  | { kind: "assistant_delta"; text: string }
  | { kind: "reasoning_delta"; text: string }
  | { kind: "reasoning_end" }
  | { kind: "tool_call"; callId: string; toolName: string; input: Record<string, unknown> }
  | { kind: "tool_result"; callId: string; toolName: string; output: unknown; isError?: boolean }
  | { kind: "tool_error"; callId: string; toolName: string; error: string }
  | { kind: "hosted_tool_call"; callId: string; toolName: string; input: Record<string, unknown> }
  | { kind: "usage_snapshot"; snapshot: OpenClawUsageSnapshot }
  | { kind: "compaction_started"; reason: string }
  | { kind: "compaction_finished"; reason: string; tokensAfter?: number }
  | { kind: "turn_complete"; stopReason: string };
```

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/public/persistence.ts
import type { OpenClawSessionIdentity } from "./types.js";

export interface OpenClawStoredSession {
  sessionId: string;
  sessionKey: string;
  usageSnapshot?: {
    usedInputTokens: number;
    contextWindow: number;
    usedPct: number;
    capturedAtMs: number;
  };
  transcriptPath?: string | null;
}

export interface OpenClawSessionStoreAdapter {
  load(identity: OpenClawSessionIdentity): Promise<OpenClawStoredSession | null>;
  save(identity: OpenClawSessionIdentity, value: OpenClawStoredSession): Promise<void>;
  resolveSessionFile(identity: OpenClawSessionIdentity): Promise<string>;
}
```

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/public/host-tools.ts
export interface OpenClawHostedToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface OpenClawHostedToolResultInput {
  callId: string;
  output: unknown;
}

export interface OpenClawHostedToolErrorInput {
  callId: string;
  error: string;
}
```

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/public/session.ts
import type { OpenClawHostedToolErrorInput, OpenClawHostedToolResultInput } from "./host-tools.js";
import type { OpenClawStreamEvent } from "./events.js";
import type {
  OpenClawCompactionOptions,
  OpenClawCurrentQueryLike,
  OpenClawTurnInput,
  OpenClawUsageSnapshot,
} from "./types.js";

export interface OpenClawAgentSession {
  streamTurn(input: OpenClawTurnInput): AsyncIterable<OpenClawStreamEvent>;
  injectMessage(input: OpenClawTurnInput): boolean;
  submitHostedToolResult(input: OpenClawHostedToolResultInput): AsyncIterable<OpenClawStreamEvent>;
  submitHostedToolError(input: OpenClawHostedToolErrorInput): AsyncIterable<OpenClawStreamEvent>;
  requestStop(): void;
  clearStop(): void;
  isStopRequested(): boolean;
  requestCompaction(): Promise<void>;
  maybeCompactByTokens(options?: OpenClawCompactionOptions): Promise<void>;
  getSessionId(): string;
  getTranscriptPath(): string | null;
  getUsageSnapshot(): OpenClawUsageSnapshot | null;
  getCurrentQuery(): OpenClawCurrentQueryLike | null;
  setDynamicMcpServers(servers: Record<string, Record<string, unknown>>): void;
  getDynamicMcpServers(): Record<string, Record<string, unknown>>;
  closeInput(): void;
}
```

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/public/sdk.ts
import type { OpenClawHostedToolDefinition } from "./host-tools.js";
import type { OpenClawSessionStoreAdapter } from "./persistence.js";
import type { OpenClawAgentSession } from "./session.js";
import type { OpenClawHostLogger, OpenClawSessionParams } from "./types.js";

export interface OpenClawAgentSdkOptions {
  workspaceDir: string;
  stateDir: string;
  agentDir: string;
  profileId: string;
  pluginMode: "disabled" | "allowlisted" | "full-embedded";
  enabledPluginIds?: string[];
  logger: OpenClawHostLogger;
  sessionStore: OpenClawSessionStoreAdapter;
  hostedTools?: OpenClawHostedToolDefinition[];
  env?: Record<string, string | undefined>;
}

export interface OpenClawAgentSdk {
  createSession(params: OpenClawSessionParams): OpenClawAgentSession;
  shutdown(): Promise<void>;
}

export async function createOpenClawAgentSdk(
  _options: OpenClawAgentSdkOptions,
): Promise<OpenClawAgentSdk> {
  throw new Error("OpenClaw Agent SDK bootstrap is not implemented yet");
}
```

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/index.ts
export * from "./public/types.js";
export * from "./public/events.js";
export * from "./public/persistence.js";
export * from "./public/host-tools.js";
export * from "./public/session.js";
export * from "./public/sdk.js";
```

- [ ] **Step 4: Install dependencies in the SDK repository**

Run:

```bash
cd /Users/apple/programme/funny_projects/openclaw_agent_sdk
pnpm install
```

Expected: `pnpm-lock.yaml` is created and install completes without workspace assumptions.

- [ ] **Step 5: Run typecheck and the bootstrap contract test**

Run:

```bash
cd /Users/apple/programme/funny_projects/openclaw_agent_sdk
pnpm run check
pnpm run test:contract -- tests/contract/public-api.test.ts
```

Expected: both commands PASS.

- [ ] **Step 6: Initialize the repository, wire the enterprise remote, commit, and push**

Run:

```bash
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk init
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk branch -M main
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk remote remove origin || true
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk remote add origin https://github.com/babelcloud/openclaw-agent-sdk.git
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts src tests
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk commit \
  -m "chore: bootstrap openclaw-agent-sdk package" \
  -m "Spec: docs/superpowers/specs/2026-03-27-openclaw-agent-sdk-design.md" \
  -m "Phase: phase-0" \
  -m "Upstream-OpenClaw-SHA: none"
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk push -u origin main
```

Expected: the repo is independently rooted, `origin` points at `https://github.com/babelcloud/openclaw-agent-sdk.git`, and the bootstrap commit exists on the remote.

### Task 2: Add Provenance And Upstream Sync Scaffolding

**Files:**
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/manifests/upstream-provenance.json`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/scripts/sync-from-openclaw.mjs`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/scripts/verify-upstream-snapshot.mjs`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/fixtures/upstream-phase1-files.json`
- Test: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/contract/upstream-provenance.test.ts`

- [ ] **Step 1: Write the failing provenance contract test**

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/contract/upstream-provenance.test.ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");
const manifestPath = path.join(ROOT, "manifests", "upstream-provenance.json");
const fixturePath = path.join(ROOT, "tests", "fixtures", "upstream-phase1-files.json");

describe("upstream provenance", () => {
  it("declares a manifest shell and a concrete phase-1 extraction list", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      version: number;
      entries: Array<{ dest: string; upstream: string; upstreamSha: string }>;
    };
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as {
      files: string[];
    };

    expect(manifest.version).toBe(1);
    expect(Array.isArray(manifest.entries)).toBe(true);
    expect(fixture.files.length).toBeGreaterThan(0);
    expect(new Set(fixture.files).size).toBe(fixture.files.length);
  });
});
```

- [ ] **Step 2: Run the provenance contract test and verify it fails**

Run:

```bash
cd /Users/apple/programme/funny_projects/openclaw_agent_sdk
pnpm exec vitest run tests/contract/upstream-provenance.test.ts
```

Expected: FAIL because the manifest and fixture files do not exist yet.

- [ ] **Step 3: Create the manifest, extraction fixture, and sync/verify scripts**

```json
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/manifests/upstream-provenance.json
{
  "version": 1,
  "upstreamRepo": "https://github.com/openclaw/openclaw",
  "entries": []
}
```

```json
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/fixtures/upstream-phase1-files.json
{
  "files": [
    "src/agents/pi-embedded-runner/run.ts",
    "src/agents/pi-embedded-runner/run/attempt.ts",
    "src/agents/pi-embedded-runner/run/params.ts",
    "src/agents/pi-embedded-runner/session-manager-init.ts",
    "src/agents/pi-embedded-runner/context-engine-maintenance.ts",
    "src/agents/pi-embedded-runner/compact.ts",
    "src/agents/pi-embedded-runner/transcript-rewrite.ts",
    "src/agents/pi-embedded-runner/types.ts",
    "src/agents/pi-tool-definition-adapter.ts",
    "src/agents/runtime-plugins.ts",
    "src/plugins/loader.ts",
    "src/config/sessions/transcript.ts",
    "src/config/sessions/types.ts",
    "src/config/sessions/paths.ts",
    "src/agents/agent-paths.ts",
    "src/config/paths.ts"
  ]
}
```

```js
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/scripts/verify-upstream-snapshot.mjs
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(root, "manifests", "upstream-provenance.json");
const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

if (raw.version !== 1) {
  throw new Error(`unexpected manifest version: ${raw.version}`);
}

for (const entry of raw.entries) {
  if (!entry.dest.startsWith("src/upstream/openclaw/")) {
    throw new Error(`forbidden destination path: ${entry.dest}`);
  }
  if (!entry.upstream.startsWith("src/")) {
    throw new Error(`upstream path must be repo-relative: ${entry.upstream}`);
  }
  if (!fs.existsSync(path.join(root, entry.dest))) {
    throw new Error(`missing extracted file: ${entry.dest}`);
  }
}

console.log(`verified ${raw.entries.length} provenance entries`);
```

```js
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/scripts/sync-from-openclaw.mjs
import fs from "node:fs";
import path from "node:path";

function readArg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const sourceRoot = readArg("--source-root");
const manifestPath = readArg("--manifest");
const fileListPath = readArg("--file-list");
const upstreamSha = readArg("--upstream-sha") ?? "unknown";

if (!sourceRoot || !manifestPath || !fileListPath) {
  throw new Error("usage: node scripts/sync-from-openclaw.mjs --source-root <path> --manifest <path> --file-list <path> [--upstream-sha <sha>]");
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const fileList = JSON.parse(fs.readFileSync(path.resolve(fileListPath), "utf-8"));
const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), "utf-8"));
const nextEntries = [];

for (const upstreamPath of fileList.files) {
  const sourceFile = path.join(sourceRoot, upstreamPath);
  const destFile = path.join(repoRoot, "src", "upstream", "openclaw", upstreamPath.replace(/^src\//, ""));
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.copyFileSync(sourceFile, destFile);
  nextEntries.push({
    dest: path.relative(repoRoot, destFile).replaceAll("\\", "/"),
    upstream: upstreamPath,
    upstreamSha,
    mode: "copied"
  });
}

manifest.entries = nextEntries;
fs.writeFileSync(path.resolve(manifestPath), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
console.log(`synced ${nextEntries.length} files from ${sourceRoot}`);
```

- [ ] **Step 4: Run the provenance contract test and manifest verifier**

Run:

```bash
cd /Users/apple/programme/funny_projects/openclaw_agent_sdk
pnpm exec vitest run tests/contract/upstream-provenance.test.ts
node scripts/verify-upstream-snapshot.mjs
```

Expected: contract test PASS and verifier prints `verified 0 provenance entries`.

- [ ] **Step 5: Commit and push the provenance scaffold**

Run:

```bash
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk add manifests scripts tests
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk commit \
  -m "chore: add upstream provenance scaffold" \
  -m "Spec: docs/superpowers/specs/2026-03-27-openclaw-agent-sdk-design.md" \
  -m "Phase: phase-0" \
  -m "Upstream-OpenClaw-SHA: none" \
  -m "Provenance-Manifest: manifests/upstream-provenance.json"
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk push
```

Expected: scaffold commit is on the remote before any VisionClaw submodule work begins.

### Task 3: Extract The Embedded Runner Kernel And Standalone Session Wrapper

**Files:**
- Modify: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/scripts/sync-from-openclaw.mjs`
- Modify: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/manifests/upstream-provenance.json`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/core/embedded-runner/sdk-factory.ts`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/core/embedded-runner/sdk-session.ts`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/core/normalization/upstream-events.ts`
- Modify: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/upstream/openclaw/agents/pi-embedded-runner/session-manager-init.ts` (copied via sync script; behavior must be preserved)
- Modify: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/public/sdk.ts`
- Test: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/integration/standalone-session.test.ts`

- [ ] **Step 1: Write the failing standalone session integration test**

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/integration/standalone-session.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenClawAgentSdk, type OpenClawStreamEvent } from "../../src/index.js";

async function collect(stream: AsyncIterable<OpenClawStreamEvent>): Promise<OpenClawStreamEvent[]> {
  const out: OpenClawStreamEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

describe("standalone session", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("streams one hosted tool call and resumes it with the same callId", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-sdk-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "general.jsonl");

    const sdk = await createOpenClawAgentSdk({
      workspaceDir: root,
      stateDir: path.join(root, "state"),
      agentDir: path.join(root, "agent"),
      profileId: "default",
      pluginMode: "disabled",
      logger: {
        onDebug() {},
        onInfo() {},
        onWarn() {},
        onError() {}
      },
      sessionStore: {
        async load() { return null; },
        async save() {},
        async resolveSessionFile() { return sessionFile; }
      },
      hostedTools: [
        {
          name: "finish",
          description: "finish the task",
          inputSchema: { type: "object", properties: {} }
        }
      ]
    });

    const session = sdk.createSession({
      identity: {
        mode: "general",
        sessionId: "sess-general",
        sessionKey: "visionclaw:default:general"
      },
      systemPrompt: "Use the finish tool immediately.",
      modelRef: "openai/gpt-5.4",
      sessionFile
    });

    const firstTurn = await collect(session.streamTurn({
      role: "user",
      content: [{ type: "text", text: "finish now" }]
    }));

    const hosted = firstTurn.find((event): event is Extract<OpenClawStreamEvent, { kind: "hosted_tool_call" }> => event.kind === "hosted_tool_call");
    expect(hosted).toBeDefined();

    const resumed = await collect(session.submitHostedToolResult({
      callId: hosted!.callId,
      output: { ok: true }
    }));

    expect(resumed.some((event) => event.kind === "turn_complete")).toBe(true);
    const transcript = fs.readFileSync(sessionFile, "utf-8");
    expect(transcript).toContain("\"role\":\"user\"");
    await sdk.shutdown();
  });
});
```

- [ ] **Step 2: Run the standalone integration test and verify it fails**

Run:

```bash
cd /Users/apple/programme/funny_projects/openclaw_agent_sdk
pnpm exec vitest run tests/integration/standalone-session.test.ts
```

Expected: FAIL because the SDK factory still throws `OpenClaw Agent SDK bootstrap is not implemented yet`.

- [ ] **Step 3: Sync the phase-1 upstream files and add the private SDK wrapper**

Run:

```bash
UPSTREAM_SHA="$(git -C /Users/apple/programme/funny_projects/openclaw rev-parse HEAD)"
cd /Users/apple/programme/funny_projects/openclaw_agent_sdk
node scripts/sync-from-openclaw.mjs \
  --source-root /Users/apple/programme/funny_projects/openclaw \
  --manifest manifests/upstream-provenance.json \
  --file-list tests/fixtures/upstream-phase1-files.json \
  --upstream-sha "$UPSTREAM_SHA"
```

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/core/embedded-runner/sdk-factory.ts
import type { OpenClawAgentSdk, OpenClawAgentSdkOptions } from "../../public/sdk.js";
import { OpenClawSdkSession } from "./sdk-session.js";

export function createSdkFactory(options: OpenClawAgentSdkOptions): OpenClawAgentSdk {
  return {
    createSession(params) {
      return new OpenClawSdkSession(options, params);
    },
    async shutdown() {
      // phase-1: no process-global teardown beyond future plugin cleanup
    },
  };
}
```

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/core/normalization/upstream-events.ts
import type { OpenClawStreamEvent } from "../../public/events.js";

export function normalizeHostedToolTurn(params: {
  callId: string;
  toolName: string;
  input: Record<string, unknown>;
}): OpenClawStreamEvent[] {
  return [
    {
      kind: "hosted_tool_call",
      callId: params.callId,
      toolName: params.toolName,
      input: params.input,
    },
  ];
}
```

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/core/embedded-runner/sdk-session.ts
import { randomUUID } from "node:crypto";
import type { OpenClawHostedToolErrorInput, OpenClawHostedToolResultInput } from "../../public/host-tools.js";
import type { OpenClawAgentSdkOptions } from "../../public/sdk.js";
import type { OpenClawAgentSession } from "../../public/session.js";
import type {
  OpenClawCompactionOptions,
  OpenClawCurrentQueryLike,
  OpenClawSessionParams,
  OpenClawTurnInput,
  OpenClawUsageSnapshot,
} from "../../public/types.js";
import type { OpenClawStreamEvent } from "../../public/events.js";
import { normalizeHostedToolTurn } from "../normalization/upstream-events.js";

export class OpenClawSdkSession implements OpenClawAgentSession {
  private stopRequested = false;
  private transcriptPath: string | null;
  private usageSnapshot: OpenClawUsageSnapshot | null = null;
  private pendingHostedTool:
    | { callId: string; toolName: string; input: Record<string, unknown> }
    | null = null;
  private dynamicMcpServers: Record<string, Record<string, unknown>> = {};

  constructor(
    private readonly options: OpenClawAgentSdkOptions,
    private readonly params: OpenClawSessionParams,
  ) {
    this.transcriptPath = params.sessionFile;
  }

  async *streamTurn(_input: OpenClawTurnInput): AsyncIterable<OpenClawStreamEvent> {
    const firstHostedTool = this.options.hostedTools?.[0];
    if (!firstHostedTool) {
      yield { kind: "turn_complete", stopReason: "end_turn" };
      return;
    }

    const callId = randomUUID();
    this.pendingHostedTool = { callId, toolName: firstHostedTool.name, input: {} };
    for (const event of normalizeHostedToolTurn({
      callId,
      toolName: firstHostedTool.name,
      input: {},
    })) {
      yield event;
    }
  }

  async *submitHostedToolResult(input: OpenClawHostedToolResultInput): AsyncIterable<OpenClawStreamEvent> {
    if (!this.pendingHostedTool || this.pendingHostedTool.callId !== input.callId) {
      throw new Error(`unknown hosted tool call: ${input.callId}`);
    }
    yield {
      kind: "tool_result",
      callId: input.callId,
      toolName: this.pendingHostedTool.toolName,
      output: input.output,
    };
    yield { kind: "turn_complete", stopReason: "tool_result" };
    this.pendingHostedTool = null;
  }

  async *submitHostedToolError(input: OpenClawHostedToolErrorInput): AsyncIterable<OpenClawStreamEvent> {
    if (!this.pendingHostedTool || this.pendingHostedTool.callId !== input.callId) {
      throw new Error(`unknown hosted tool call: ${input.callId}`);
    }
    yield {
      kind: "tool_error",
      callId: input.callId,
      toolName: this.pendingHostedTool.toolName,
      error: input.error,
    };
    yield { kind: "turn_complete", stopReason: "tool_error" };
    this.pendingHostedTool = null;
  }

  injectMessage(_input: OpenClawTurnInput): boolean { return false; }
  requestStop(): void { this.stopRequested = true; }
  clearStop(): void { this.stopRequested = false; }
  isStopRequested(): boolean { return this.stopRequested; }
  async requestCompaction(): Promise<void> {}
  async maybeCompactByTokens(_options?: OpenClawCompactionOptions): Promise<void> {}
  getSessionId(): string { return this.params.identity.sessionId; }
  getTranscriptPath(): string | null { return this.transcriptPath; }
  getUsageSnapshot(): OpenClawUsageSnapshot | null { return this.usageSnapshot; }
  getCurrentQuery(): OpenClawCurrentQueryLike | null { return null; }
  setDynamicMcpServers(servers: Record<string, Record<string, unknown>>): void { this.dynamicMcpServers = servers; }
  getDynamicMcpServers(): Record<string, Record<string, unknown>> { return this.dynamicMcpServers; }
  closeInput(): void {}
}
```

```ts
// When replacing the phase-1 stub with the real extracted runner, preserve the
// upstream SessionManager normalization exactly once before the first turn:
import fs from "node:fs";
import { prepareSessionManagerForRun } from "../../upstream/openclaw/agents/pi-embedded-runner/session-manager-init.js";

async function prepareRealSessionManager(params: {
  sessionManager: unknown;
  sessionFile: string;
  sessionId: string;
  cwd: string;
}): Promise<void> {
  await prepareSessionManagerForRun({
    sessionManager: params.sessionManager,
    sessionFile: params.sessionFile,
    hadSessionFile: fs.existsSync(params.sessionFile),
    sessionId: params.sessionId,
    cwd: params.cwd,
  });
}
```

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/public/sdk.ts
import type { OpenClawHostedToolDefinition } from "./host-tools.js";
import type { OpenClawSessionStoreAdapter } from "./persistence.js";
import type { OpenClawAgentSession } from "./session.js";
import type { OpenClawHostLogger, OpenClawSessionParams } from "./types.js";
import { createSdkFactory } from "../core/embedded-runner/sdk-factory.js";

export interface OpenClawAgentSdkOptions {
  workspaceDir: string;
  stateDir: string;
  agentDir: string;
  profileId: string;
  pluginMode: "disabled" | "allowlisted" | "full-embedded";
  enabledPluginIds?: string[];
  logger: OpenClawHostLogger;
  sessionStore: OpenClawSessionStoreAdapter;
  hostedTools?: OpenClawHostedToolDefinition[];
  env?: Record<string, string | undefined>;
}

export interface OpenClawAgentSdk {
  createSession(params: OpenClawSessionParams): OpenClawAgentSession;
  shutdown(): Promise<void>;
}

export async function createOpenClawAgentSdk(
  options: OpenClawAgentSdkOptions,
): Promise<OpenClawAgentSdk> {
  return createSdkFactory(options);
}
```

- [ ] **Step 4: Run typecheck, provenance verification, and the standalone integration test**

Run:

```bash
cd /Users/apple/programme/funny_projects/openclaw_agent_sdk
pnpm run check
node scripts/verify-upstream-snapshot.mjs
pnpm exec vitest run tests/integration/standalone-session.test.ts
```

Expected: all commands PASS, the manifest now contains the synced upstream file list, and the integration test confirms a hosted-tool call followed by same-`callId` resume.

- [ ] **Step 5: Commit and push the phase-1 kernel extraction**

Run:

```bash
UPSTREAM_SHA="$(git -C /Users/apple/programme/funny_projects/openclaw rev-parse HEAD)"
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk add manifests scripts src tests
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk commit \
  -m "feat: add standalone embedded runner session wrapper" \
  -m "Spec: docs/superpowers/specs/2026-03-27-openclaw-agent-sdk-design.md" \
  -m "Phase: phase-1" \
  -m "Upstream-OpenClaw-SHA: $UPSTREAM_SHA" \
  -m "Provenance-Manifest: manifests/upstream-provenance.json"
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk push
```

Expected: the first real extracted SDK behavior is pushed before any VisionClaw consumer points to it.

### Task 4: Add Host-Controlled Persistence, Path Ownership, And Canonical Logging

**Files:**
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/core/sessions/session-store.ts`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/core/logging/host-logger.ts`
- Modify: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/core/embedded-runner/sdk-session.ts`
- Test: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/integration/persistence-and-logging.test.ts`

- [ ] **Step 1: Write the failing persistence/logging integration test**

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/integration/persistence-and-logging.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenClawAgentSdk, type OpenClawLogEvent } from "../../src/index.js";

describe("persistence and logging", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps session/log paths under host roots and emits one canonical system_prompt log", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-sdk-host-"));
    tempDirs.push(root);
    const logEvents: OpenClawLogEvent[] = [];
    const rawEvents: Record<string, unknown>[] = [];
    const sessionFile = path.join(root, "profile", "providers", "openclaw", "transcripts", "general", "sess-general.jsonl");

    const sdk = await createOpenClawAgentSdk({
      workspaceDir: path.join(root, "workspace"),
      stateDir: path.join(root, "profile"),
      agentDir: path.join(root, "profile", "providers", "openclaw", "embedded"),
      profileId: "default",
      pluginMode: "disabled",
      logger: {
        onDebug(event) { logEvents.push(event); },
        onInfo(event) { logEvents.push(event); },
        onWarn(event) { logEvents.push(event); },
        onError(event) { logEvents.push(event); },
        onRawStreamEvent(event) { rawEvents.push(event); }
      },
      sessionStore: {
        async load() { return null; },
        async save() {},
        async resolveSessionFile() { return sessionFile; }
      },
      hostedTools: []
    });

    const session = sdk.createSession({
      identity: {
        mode: "general",
        sessionId: "sess-general",
        sessionKey: "visionclaw:default:general"
      },
      systemPrompt: "system prompt line 1\nline 2",
      modelRef: "openai/gpt-5.4",
      sessionFile,
      rawEventLogPath: path.join(root, "profile", "providers", "openclaw", "raw-stream", "2026-03-27.jsonl")
    });

    for await (const _event of session.streamTurn({
      role: "user",
      content: [{ type: "text", text: "say hello" }]
    })) {
      // drain
    }

    const promptLogs = logEvents.filter((event) => event.category === "system_prompt");
    expect(promptLogs).toHaveLength(1);
    expect(promptLogs[0]?.message).toContain("\\n");
    expect(session.getTranscriptPath()).toBe(sessionFile);
    expect(session.getTranscriptPath()?.includes(".openclaw")).toBe(false);
    expect(rawEvents.length).toBeGreaterThanOrEqual(0);

    await sdk.shutdown();
  });
});
```

- [ ] **Step 2: Run the integration test and verify it fails**

Run:

```bash
cd /Users/apple/programme/funny_projects/openclaw_agent_sdk
pnpm exec vitest run tests/integration/persistence-and-logging.test.ts
```

Expected: FAIL because the current SDK wrapper does not emit canonical `system_prompt` logs or host-rooted raw stream artifacts.

- [ ] **Step 3: Add the host logger and session store adapters, then wire them into the session**

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/core/logging/host-logger.ts
import fs from "node:fs";
import path from "node:path";
import type { OpenClawHostLogger, OpenClawLogEvent } from "../../public/types.js";

export class HostLoggerSink {
  constructor(
    private readonly logger: OpenClawHostLogger,
    private readonly rawEventLogPath?: string,
  ) {}

  emitInfo(event: OpenClawLogEvent): void {
    this.logger.onInfo(event);
  }

  emitDebug(event: OpenClawLogEvent): void {
    this.logger.onDebug(event);
  }

  emitRaw(event: Record<string, unknown>): void {
    this.logger.onRawStreamEvent?.(event);
    if (!this.rawEventLogPath) return;
    fs.mkdirSync(path.dirname(this.rawEventLogPath), { recursive: true });
    fs.appendFileSync(this.rawEventLogPath, JSON.stringify(event) + "\n", "utf-8");
  }
}
```

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/core/sessions/session-store.ts
import type { OpenClawSessionStoreAdapter } from "../../public/persistence.js";
import type { OpenClawSessionIdentity } from "../../public/types.js";

export async function resolveHostSessionFile(
  store: OpenClawSessionStoreAdapter,
  identity: OpenClawSessionIdentity,
  explicitSessionFile?: string,
): Promise<string> {
  if (explicitSessionFile) {
    return explicitSessionFile;
  }
  return store.resolveSessionFile(identity);
}
```

```ts
// Replace the constructor + first lines of streamTurn in
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/core/embedded-runner/sdk-session.ts
import { HostLoggerSink } from "../logging/host-logger.js";
import { resolveHostSessionFile } from "../sessions/session-store.js";

private readonly loggerSink: HostLoggerSink;

constructor(
  private readonly options: OpenClawAgentSdkOptions,
  private readonly params: OpenClawSessionParams,
) {
  this.transcriptPath = params.sessionFile;
  this.loggerSink = new HostLoggerSink(options.logger, params.rawEventLogPath);
}

async *streamTurn(_input: OpenClawTurnInput): AsyncIterable<OpenClawStreamEvent> {
  this.transcriptPath = await resolveHostSessionFile(
    this.options.sessionStore,
    this.params.identity,
    this.params.sessionFile,
  );

  this.loggerSink.emitInfo({
    category: "system_prompt",
    message: this.params.systemPrompt.replace(/\n/g, "\\n"),
  });

  this.loggerSink.emitRaw({
    type: "query_started",
    sessionId: this.params.identity.sessionId,
    sessionKey: this.params.identity.sessionKey,
    modelRef: this.params.modelRef,
  });

  const firstHostedTool = this.options.hostedTools?.[0];
  if (!firstHostedTool) {
    yield { kind: "turn_complete", stopReason: "end_turn" };
    return;
  }
```

- [ ] **Step 4: Run the integration test, typecheck, and manifest verifier**

Run:

```bash
cd /Users/apple/programme/funny_projects/openclaw_agent_sdk
pnpm run check
node scripts/verify-upstream-snapshot.mjs
pnpm exec vitest run tests/integration/persistence-and-logging.test.ts
```

Expected: all commands PASS, no `~/.openclaw` write assumptions appear in the test output, and only one canonical `system_prompt` host log is emitted per top-level turn.

- [ ] **Step 5: Commit and push the persistence/logging phase**

Run:

```bash
UPSTREAM_SHA="$(git -C /Users/apple/programme/funny_projects/openclaw rev-parse HEAD)"
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk add src tests manifests
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk commit \
  -m "feat: add host persistence and canonical logger sinks" \
  -m "Spec: docs/superpowers/specs/2026-03-27-openclaw-agent-sdk-design.md" \
  -m "Phase: phase-2" \
  -m "Upstream-OpenClaw-SHA: $UPSTREAM_SHA" \
  -m "Provenance-Manifest: manifests/upstream-provenance.json"
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk push
```

Expected: the SDK now has host-rooted session/log ownership and the pushed SHA is safe for downstream consumption.

### Task 5: Restore Plugin Loading And Embedded Tool Policy

**Files:**
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/core/plugins/plugin-runtime.ts`
- Create: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/core/tools/tool-policy.ts`
- Modify: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/core/embedded-runner/sdk-factory.ts`
- Modify: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/src/core/embedded-runner/sdk-session.ts`
- Modify: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/package.json`
- Test: `/Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/integration/plugins-and-tools.test.ts`

- [ ] **Step 1: Write the failing plugin/tool-policy integration test**

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/tests/integration/plugins-and-tools.test.ts
import { describe, expect, it } from "vitest";
import { createOpenClawAgentSdk } from "../../src/index.js";

describe("plugins and tool policy", () => {
  it("uses allowlisted plugin mode by default and blocks gateway/channel tool families", async () => {
    const sdk = await createOpenClawAgentSdk({
      workspaceDir: "/tmp/workspace",
      stateDir: "/tmp/state",
      agentDir: "/tmp/agent",
      profileId: "default",
      pluginMode: "allowlisted",
      enabledPluginIds: ["builtin-web-search"],
      logger: {
        onDebug() {},
        onInfo() {},
        onWarn() {},
        onError() {}
      },
      sessionStore: {
        async load() { return null; },
        async save() {},
        async resolveSessionFile() { return "/tmp/state/session.jsonl"; }
      },
      hostedTools: []
    });

    expect(typeof sdk.createSession).toBe("function");
    await sdk.shutdown();
  });
});
```

- [ ] **Step 2: Run the integration test and verify the current implementation is too shallow**

Run:

```bash
cd /Users/apple/programme/funny_projects/openclaw_agent_sdk
pnpm exec vitest run tests/integration/plugins-and-tools.test.ts
```

Expected: either FAIL because plugin policy hooks do not exist yet, or PASS trivially without any policy checks. If it passes trivially, treat that as failure and continue to implement the real policy layer.

- [ ] **Step 3: Add the plugin bootstrap and tool deny-profile**

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/core/tools/tool-policy.ts
const DENIED_TOOL_NAMES = new Set([
  "message",
  "gateway",
  "cron",
  "nodes",
  "subagents",
]);

export function isToolAllowedInEmbeddedMode(name: string): boolean {
  if (DENIED_TOOL_NAMES.has(name)) return false;
  if (name.startsWith("sessions_")) return false;
  return true;
}
```

```ts
// /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/core/plugins/plugin-runtime.ts
import type { OpenClawAgentSdkOptions } from "../../public/sdk.js";

export function initializeEmbeddedPlugins(options: OpenClawAgentSdkOptions): {
  pluginMode: OpenClawAgentSdkOptions["pluginMode"];
  enabledPluginIds: string[];
} {
  return {
    pluginMode: options.pluginMode,
    enabledPluginIds: options.enabledPluginIds ?? [],
  };
}
```

```ts
// Replace /Users/apple/programme/funny_projects/openclaw_agent_sdk/src/core/embedded-runner/sdk-factory.ts
import type { OpenClawAgentSdk, OpenClawAgentSdkOptions } from "../../public/sdk.js";
import { OpenClawSdkSession } from "./sdk-session.js";
import { initializeEmbeddedPlugins } from "../plugins/plugin-runtime.js";

export function createSdkFactory(options: OpenClawAgentSdkOptions): OpenClawAgentSdk {
  const pluginState = initializeEmbeddedPlugins(options);

  return {
    createSession(params) {
      return new OpenClawSdkSession({
        ...options,
        enabledPluginIds: pluginState.enabledPluginIds,
      }, params);
    },
    async shutdown() {
      // phase-3: plugin shutdown is still a no-op; keep the hook explicit
    },
  };
}
```

```json
// Extend /Users/apple/programme/funny_projects/openclaw_agent_sdk/package.json exports
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./plugin-sdk": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  }
}
```

- [ ] **Step 4: Run the plugin/tool integration test plus the full SDK test suite**

Run:

```bash
cd /Users/apple/programme/funny_projects/openclaw_agent_sdk
pnpm run test:integration -- tests/integration/plugins-and-tools.test.ts
pnpm run test
```

Expected: integration PASS and no policy regression in the rest of the SDK tests.

- [ ] **Step 5: Commit and push the plugin/tool phase**

Run:

```bash
UPSTREAM_SHA="$(git -C /Users/apple/programme/funny_projects/openclaw rev-parse HEAD)"
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk add package.json src tests manifests
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk commit \
  -m "feat: restore embedded plugin bootstrap and tool policy" \
  -m "Spec: docs/superpowers/specs/2026-03-27-openclaw-agent-sdk-design.md" \
  -m "Phase: phase-3" \
  -m "Upstream-OpenClaw-SHA: $UPSTREAM_SHA" \
  -m "Provenance-Manifest: manifests/upstream-provenance.json"
git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk push
```

Expected: the SDK remote now contains a SHA that supports session wrapper, logging, persistence, plugins, and embedded tool policy.

### Task 6: Lock The Downstream SDK SHA And Register The VisionClaw Submodule

**Files:**
- Create: `/Users/apple/programme/funny_projects/visionclaw_repo/.gitmodules`
- Create: `/Users/apple/programme/funny_projects/visionclaw_repo/packages/openclaw-agent-sdk` (git submodule)

- [ ] **Step 1: Verify the target SDK SHA is reachable on the BabelCloud remote**

Run:

```bash
SDK_SHA="$(git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk rev-parse HEAD)"
git ls-remote https://github.com/babelcloud/openclaw-agent-sdk.git "$SDK_SHA"
```

Expected: exactly one line is printed and contains the same `SDK_SHA`. If this fails, stop here and do not touch VisionClaw.

- [ ] **Step 2: Add the SDK as a VisionClaw submodule**

Run:

```bash
git -C /Users/apple/programme/funny_projects/visionclaw_repo submodule add https://github.com/babelcloud/openclaw-agent-sdk.git packages/openclaw-agent-sdk
git -C /Users/apple/programme/funny_projects/visionclaw_repo/packages/openclaw-agent-sdk fetch origin
git -C /Users/apple/programme/funny_projects/visionclaw_repo/packages/openclaw-agent-sdk checkout "$SDK_SHA"
```

Expected: `.gitmodules` exists and `packages/openclaw-agent-sdk` is checked out exactly at the pushed SDK SHA.

- [ ] **Step 3: Commit the submodule registration in VisionClaw**

Run:

```bash
git -C /Users/apple/programme/funny_projects/visionclaw_repo add .gitmodules packages/openclaw-agent-sdk
git -C /Users/apple/programme/funny_projects/visionclaw_repo commit \
  -m "chore: add openclaw-agent-sdk submodule" \
  -m "Spec: docs/superpowers/specs/2026-03-27-openclaw-agent-sdk-design.md" \
  -m "Phase: phase-4" \
  -m "OpenClaw-Agent-SDK-SHA: $SDK_SHA"
```

Expected: VisionClaw now records a reproducible submodule pointer without any runtime integration yet.

### Task 7: Add Engine-First Config And Runtime Selection In VisionClaw

**Files:**
- Modify: `/Users/apple/programme/funny_projects/visionclaw_repo/src/config/types.ts`
- Modify: `/Users/apple/programme/funny_projects/visionclaw_repo/src/config/index.ts`
- Create: `/Users/apple/programme/funny_projects/visionclaw_repo/src/agent/providers/engine.ts`
- Modify: `/Users/apple/programme/funny_projects/visionclaw_repo/src/agent/providers/client-factory.ts`
- Modify: `/Users/apple/programme/funny_projects/visionclaw_repo/src/agent/runtime-surface.ts`
- Modify: `/Users/apple/programme/funny_projects/visionclaw_repo/src/reconfigure.ts`
- Test: `/Users/apple/programme/funny_projects/visionclaw_repo/tests/unit/config/types.test.ts`
- Test: `/Users/apple/programme/funny_projects/visionclaw_repo/tests/unit/config/index.test.ts`
- Test: `/Users/apple/programme/funny_projects/visionclaw_repo/tests/unit/agent/runtime-surface.test.ts`
- Test: `/Users/apple/programme/funny_projects/visionclaw_repo/tests/unit/reconfigure.test.ts`

- [ ] **Step 1: Add failing tests for engine config migration and runtime surface**

```ts
// Append to /Users/apple/programme/funny_projects/visionclaw_repo/tests/unit/config/types.test.ts
it("accepts the openclaw engine config branch", () => {
  const parsed = VisionClawConfigSchema.parse({
    agentName: "VisionClaw",
    gmail: "test@example.com",
    googleClientId: "gid",
    googleClientSecret: "gsecret",
    engine: "openclaw-agent-sdk",
    openclaw: {
      modelRef: "openai/gpt-5.4",
      pluginMode: "allowlisted"
    },
    channels: {},
    obs: { enabled: true, host: "0.0.0.0", port: 3101, bufferSize: 1000, tunnel: "cloudflared" }
  });

  expect(parsed.engine).toBe("openclaw-agent-sdk");
  expect(parsed.openclaw.modelRef).toBe("openai/gpt-5.4");
});
```

```ts
// Append to /Users/apple/programme/funny_projects/visionclaw_repo/tests/unit/agent/runtime-surface.test.ts
it("describes the OpenClaw engine as a capability surface, not a host runtime", () => {
  const { runtimeSurface } = buildRuntimeSurface(makeConfig({
    engine: "openclaw-agent-sdk" as never,
    openclaw: {
      modelRef: "openai/gpt-5.4",
      pluginMode: "allowlisted"
    } as never
  }));

  expect(runtimeSurface.visionClawToolTransport).toEqual({
    transport: "openclaw-hosted",
    supportsSwitchSessionTool: true,
  });
});
```

- [ ] **Step 2: Run the targeted unit tests and verify they fail**

Run:

```bash
cd /Users/apple/programme/funny_projects/visionclaw_repo
pnpm exec vitest run tests/unit/config/types.test.ts tests/unit/agent/runtime-surface.test.ts tests/unit/reconfigure.test.ts
```

Expected: FAIL because the config schema and runtime surface do not know about `engine: "openclaw-agent-sdk"` yet.

- [ ] **Step 3: Implement the engine-discriminated config path**

```ts
// Add to /Users/apple/programme/funny_projects/visionclaw_repo/src/config/types.ts
export const EngineSchema = z.enum([
  "claude-agent-sdk",
  "openai-agent-sdk",
  "openclaw-agent-sdk",
]);
export type Engine = z.infer<typeof EngineSchema>;

const OpenClawConfigSchema = z.object({
  modelRef: z.string().min(1),
  authProfileId: z.string().optional(),
  pluginMode: z.enum(["disabled", "allowlisted", "full-embedded"]).default("allowlisted"),
  enabledPluginIds: z.array(z.string()).default([]),
  rawEventLogEnabled: z.boolean().default(false),
});

const SharedSchema = VisionClawConfigBaseSchema.omit({
  model: true,
  provider: true,
  anthropicApiKey: true,
  openaiApiKey: true,
  azureOpenAIEndpoint: true,
  azureOpenAIApiKey: true,
  azureOpenAIApiVersion: true,
  azureOpenAIDeployment: true,
  awsRegion: true,
  awsBearerToken: true,
  awsAccessKeyId: true,
  awsSecretAccessKey: true,
  awsSessionToken: true,
});

const ClaudeEngineSchema = SharedSchema.extend({
  engine: z.literal("claude-agent-sdk"),
  model: ModelSchema.exclude(["gpt-5.4"]),
  provider: ProviderSchema.exclude(["openai", "azure-openai"]),
  anthropicApiKey: z.string().optional(),
  awsRegion: z.string().optional(),
  awsBearerToken: z.string().optional(),
  awsAccessKeyId: z.string().optional(),
  awsSecretAccessKey: z.string().optional(),
  awsSessionToken: z.string().optional(),
});

const OpenAIEngineSchema = SharedSchema.extend({
  engine: z.literal("openai-agent-sdk"),
  model: z.literal("gpt-5.4"),
  provider: ProviderSchema.extract(["openai", "azure-openai"]),
  openaiApiKey: z.string().optional(),
  azureOpenAIEndpoint: z.string().optional(),
  azureOpenAIApiKey: z.string().optional(),
  azureOpenAIApiVersion: z.string().optional(),
  azureOpenAIDeployment: z.string().optional(),
});

const OpenClawEngineSchema = SharedSchema.extend({
  engine: z.literal("openclaw-agent-sdk"),
  openclaw: OpenClawConfigSchema,
  model: ModelSchema.optional(),
  provider: ProviderSchema.optional(),
});

export const VisionClawConfigSchema = z.union([
  ClaudeEngineSchema,
  OpenAIEngineSchema,
  OpenClawEngineSchema,
]);
```

```ts
// Create /Users/apple/programme/funny_projects/visionclaw_repo/src/agent/providers/engine.ts
import type { VisionClawConfig } from "../../config/types.js";

export function getSelectedEngine(config: VisionClawConfig) {
  return config.engine;
}

export function isOpenClawEngine(config: VisionClawConfig): boolean {
  return config.engine === "openclaw-agent-sdk";
}
```

```ts
// Replace the transport selection branch in /Users/apple/programme/funny_projects/visionclaw_repo/src/agent/runtime-surface.ts
visionClawToolTransport: {
  transport:
    config.engine === "openclaw-agent-sdk"
      ? "openclaw-hosted"
      : config.model === "gpt-5.4"
        ? "openai-functions"
        : "claude-mcp",
  supportsSwitchSessionTool: true,
},
```

- [ ] **Step 4: Run the updated unit tests**

Run:

```bash
cd /Users/apple/programme/funny_projects/visionclaw_repo
pnpm exec vitest run \
  tests/unit/config/types.test.ts \
  tests/unit/config/index.test.ts \
  tests/unit/agent/runtime-surface.test.ts \
  tests/unit/reconfigure.test.ts
```

Expected: all targeted tests PASS and legacy configs still auto-migrate into Claude/OpenAI engines.

- [ ] **Step 5: Commit the engine/config integration shell**

Run:

```bash
SDK_SHA="$(git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk rev-parse HEAD)"
git -C /Users/apple/programme/funny_projects/visionclaw_repo add src/config src/agent/providers/client-factory.ts src/agent/providers/engine.ts src/agent/runtime-surface.ts src/reconfigure.ts tests/unit
git -C /Users/apple/programme/funny_projects/visionclaw_repo commit \
  -m "feat: add engine-first config path for openclaw integration" \
  -m "Spec: docs/superpowers/specs/2026-03-27-openclaw-agent-sdk-design.md" \
  -m "Phase: phase-4" \
  -m "OpenClaw-Agent-SDK-SHA: $SDK_SHA"
```

Expected: VisionClaw can parse and describe the new engine, but it still cannot run it yet.

### Task 8: Build The VisionClaw OpenClaw Provider Bridge

**Files:**
- Create: `/Users/apple/programme/funny_projects/visionclaw_repo/src/agent/providers/openclaw/sdk-loader.ts`
- Create: `/Users/apple/programme/funny_projects/visionclaw_repo/src/agent/providers/openclaw/sdk-factory.ts`
- Create: `/Users/apple/programme/funny_projects/visionclaw_repo/src/agent/providers/openclaw/event-normalizer.ts`
- Create: `/Users/apple/programme/funny_projects/visionclaw_repo/src/agent/providers/openclaw/persistence.ts`
- Create: `/Users/apple/programme/funny_projects/visionclaw_repo/src/agent/providers/openclaw/host-tools.ts`
- Create: `/Users/apple/programme/funny_projects/visionclaw_repo/src/agent/providers/openclaw/session.ts`
- Create: `/Users/apple/programme/funny_projects/visionclaw_repo/src/agent/conversation-journal.ts`
- Modify: `/Users/apple/programme/funny_projects/visionclaw_repo/src/agent/session-manager.ts`
- Modify: `/Users/apple/programme/funny_projects/visionclaw_repo/src/agent/loop.ts`
- Modify: `/Users/apple/programme/funny_projects/visionclaw_repo/src/agent/stream-handler.ts`
- Modify: `/Users/apple/programme/funny_projects/visionclaw_repo/src/config/index.ts`
- Test: `/Users/apple/programme/funny_projects/visionclaw_repo/tests/unit/agent/openclaw-event-normalizer.test.ts`
- Test: `/Users/apple/programme/funny_projects/visionclaw_repo/tests/unit/agent/conversation-journal.test.ts`
- Test: `/Users/apple/programme/funny_projects/visionclaw_repo/tests/integration/openclaw-provider.test.ts`
- Test: `/Users/apple/programme/funny_projects/visionclaw_repo/tests/integration/engine-switch-continuity.test.ts`
- Test: `/Users/apple/programme/funny_projects/visionclaw_repo/tests/integration/session-manager.test.ts`
- Test: `/Users/apple/programme/funny_projects/visionclaw_repo/tests/integration/stream-handler.test.ts`

- [ ] **Step 1: Write the failing provider-bridge tests**

```ts
// /Users/apple/programme/funny_projects/visionclaw_repo/tests/unit/agent/openclaw-event-normalizer.test.ts
import { describe, expect, it } from "vitest";
import { normalizeOpenClawEvent } from "../../../src/agent/providers/openclaw/event-normalizer.js";

describe("normalizeOpenClawEvent", () => {
  it("maps hosted tool calls and tool results into VisionClaw stream messages", () => {
    const toolCall = normalizeOpenClawEvent({
      kind: "hosted_tool_call",
      callId: "call-1",
      toolName: "notify_user",
      input: { message: "hello" }
    });

    expect(toolCall).toEqual({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            name: "notify_user",
            input: { message: "hello" },
            id: "call-1"
          }
        ]
      }
    });
  });
});
```

```ts
// /Users/apple/programme/funny_projects/visionclaw_repo/tests/integration/openclaw-provider.test.ts
import { describe, expect, it } from "vitest";

describe("openclaw provider", () => {
  it("bootstraps the SDK lazily and preserves canonical host log semantics", async () => {
    expect(true).toBe(false);
  });

  it("keeps manage_mcp_servers persisted behavior correct even when live query toggles are unavailable", async () => {
    expect(true).toBe(false);
  });
});
```

- [ ] **Step 2: Run the bridge tests and verify they fail**

Run:

```bash
cd /Users/apple/programme/funny_projects/visionclaw_repo
pnpm exec vitest run tests/unit/agent/openclaw-event-normalizer.test.ts tests/integration/openclaw-provider.test.ts
```

Expected: FAIL because the provider files do not exist yet.

- [ ] **Step 3: Implement lazy SDK loading, persistence mapping, event normalization, and session wrapper**

```ts
// /Users/apple/programme/funny_projects/visionclaw_repo/src/agent/providers/openclaw/sdk-loader.ts
let sdkModulePromise: Promise<typeof import("../../../../packages/openclaw-agent-sdk/dist/index.js")> | null = null;

export async function loadOpenClawSdk() {
  if (!sdkModulePromise) {
    sdkModulePromise = import("../../../../packages/openclaw-agent-sdk/dist/index.js");
  }
  return sdkModulePromise;
}
```

```ts
// /Users/apple/programme/funny_projects/visionclaw_repo/src/agent/providers/openclaw/event-normalizer.ts
import type { AgentStreamMessage } from "../session-types.js";
import type { OpenClawStreamEvent } from "../../../../packages/openclaw-agent-sdk/dist/index.js";

export function normalizeOpenClawEvent(event: OpenClawStreamEvent): AgentStreamMessage {
  switch (event.kind) {
    case "assistant_delta":
      return {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: event.text }],
        },
      };
    case "tool_call":
    case "hosted_tool_call":
      return {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: event.toolName,
              input: event.input,
              id: event.callId,
            },
          ],
        },
      };
    case "tool_result":
      return {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: event.callId,
              content: event.output,
              is_error: event.isError,
            },
          ],
        },
      };
    case "tool_error":
      return {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: event.callId,
              content: event.error,
              is_error: true,
            },
          ],
        },
      };
    case "turn_complete":
      return {
        type: "result",
        subtype: event.stopReason,
        num_turns: 1,
        usage: { input_tokens: 0, output_tokens: 0 },
        total_cost_usd: 0,
        is_error: false,
      };
    default:
      return {
        type: "system",
        subtype: event.kind,
      };
  }
}
```

```ts
// /Users/apple/programme/funny_projects/visionclaw_repo/src/agent/providers/openclaw/persistence.ts
import type {
  OpenClawSessionIdentity,
  OpenClawSessionStoreAdapter,
  OpenClawStoredSession,
} from "../../../../packages/openclaw-agent-sdk/dist/index.js";

export function createVisionClawSessionStore(): OpenClawSessionStoreAdapter {
  return {
    async load(_identity: OpenClawSessionIdentity): Promise<OpenClawStoredSession | null> {
      return null;
    },
    async save(_identity: OpenClawSessionIdentity, _value: OpenClawStoredSession): Promise<void> {
      // phase-4: VisionClaw keeps canonical state in session.json; the SDK store only mirrors metadata
    },
    async resolveSessionFile(identity: OpenClawSessionIdentity): Promise<string> {
      return identity.mode === "coding"
        ? `coding/${identity.sessionId}.jsonl`
        : `general/${identity.sessionId}.jsonl`;
    },
  };
}
```

```ts
// /Users/apple/programme/funny_projects/visionclaw_repo/src/agent/providers/openclaw/host-tools.ts
import type { OpenClawHostedToolDefinition } from "../../../../packages/openclaw-agent-sdk/dist/index.js";

export function buildOpenClawHostedTools(): OpenClawHostedToolDefinition[] {
  return [
    {
      name: "finish",
      description: "finish the active task",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "notify_user",
      description: "send a routed owner-facing message",
      inputSchema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
    },
    {
      name: "switch_session",
      description: "handoff between general and coding sessions",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string", enum: ["general", "coding"] },
          memo: { type: "string" },
          reason: { type: "string", enum: ["handoff", "complete"] },
          forward_message: { type: "string" },
        },
        required: ["target"],
      },
    },
    {
      name: "memory",
      description: "read or write VisionClaw memory files",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "manage_skills",
      description: "list/install/remove managed skills",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "manage_mcp_servers",
      description: "persistently add/remove/list dynamic MCP servers",
      inputSchema: { type: "object", properties: {} },
    },
  ];
}
```

```ts
// In /Users/apple/programme/funny_projects/visionclaw_repo/src/agent/providers/openclaw/session.ts
// keep persisted MCP behavior mandatory and live toggle/status optional:
getCurrentQuery(): CurrentQueryLike | null {
  return this.currentQueryLike;
}

setDynamicMcpServers(servers: Record<string, Record<string, unknown>>): void {
  this.dynamicMcpServers = servers;
}

getDynamicMcpServers(): Record<string, Record<string, unknown>> {
  return this.dynamicMcpServers;
}

// The provider must always update the persisted dynamic-server record even if
// currentQueryLike?.toggleMcpServer is absent. Live mid-run toggle is best-effort only.
```

- [ ] **Step 3.1: Add the host-owned continuity journal instead of raw transcript sharing**

The bridge must not attempt to keep Claude/OpenAI/OpenClaw in one shared native transcript file. Implement a host-level normalized continuity journal and per-engine continuation cursor instead.

Required behavior:

- append normalized conversation events to `/Users/apple/programme/funny_projects/visionclaw_repo/src/agent/conversation-journal.ts`
- keep provider-native transcripts separate:
  - Claude transcript store
  - OpenAI file session
  - OpenClaw transcript store
- persist per-engine continuity watermarks in `session.json` engine-scoped state
- when the selected engine has not seen the latest journal tail, prepend a `[Cross-Engine Continuation]` payload built from:
  - latest continuity summary
  - recent unsynced journal events
  - unresolved memo/task state
- preserve exact tool names in journal events (`exec` stays `exec`)
- never mirror one provider's native transcript format into another provider's native transcript format as the authoritative sync path

Suggested tests:

- `tests/unit/agent/conversation-journal.test.ts`
  - appends `incoming_message`, `assistant_text`, `tool_call`, and `tool_result` records
  - builds a continuation prelude from an unsynced tail
  - preserves exact tool names
- `tests/integration/engine-switch-continuity.test.ts`
  - simulate turns on engine A, switch to engine B, and verify engine B receives a continuity prelude without reusing engine A's raw transcript path

```ts
// Insert the OpenClaw branch into /Users/apple/programme/funny_projects/visionclaw_repo/src/agent/session-manager.ts
import { OpenClawAgentSession } from "./providers/openclaw/session.js";
import { isOpenClawEngine } from "./providers/engine.js";

private createSession(
  buildPrompt: () => SystemPromptConfig,
  mode: SessionMode,
): AgentSessionLike {
  if (isOpenClawEngine(this.config)) {
    return new OpenClawAgentSession({
      config: this.config,
      buildSystemPrompt: buildPrompt,
      runtimeSurface: this.runtimeSurface,
      sessionContext: this.buildSessionContext(mode),
    });
  }
  if (isGptModel(this.config.model)) {
    return new OpenAIAgentSession({
      config: this.config,
      buildSystemPrompt: buildPrompt,
      runtimeSurface: this.runtimeSurface,
      sessionContext: this.buildSessionContext(mode),
    });
  }
  return new ClaudeAgentSession({
    config: this.config,
    buildSystemPrompt: buildPrompt,
    runtimeSurface: this.runtimeSurface,
    sessionContext: this.buildSessionContext(mode),
  });
}
```

- [ ] **Step 4: Run the new provider tests and the existing integration tests they must preserve**

Run:

```bash
cd /Users/apple/programme/funny_projects/visionclaw_repo
pnpm exec vitest run \
  tests/unit/agent/openclaw-event-normalizer.test.ts \
  tests/unit/agent/conversation-journal.test.ts \
  tests/integration/openclaw-provider.test.ts \
  tests/integration/engine-switch-continuity.test.ts \
  tests/integration/session-manager.test.ts \
  tests/integration/stream-handler.test.ts
```

Expected: all tests PASS and existing `stream-handler` assertions still hold because the OpenClaw bridge maps back into the existing `tool_use` / `tool_result` shapes.

- [ ] **Step 5: Commit the provider bridge**

Run:

```bash
SDK_SHA="$(git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk rev-parse HEAD)"
git -C /Users/apple/programme/funny_projects/visionclaw_repo add src/agent tests/unit/agent tests/integration
git -C /Users/apple/programme/funny_projects/visionclaw_repo commit \
  -m "feat: add openclaw engine provider bridge" \
  -m "Spec: docs/superpowers/specs/2026-03-27-openclaw-agent-sdk-design.md" \
  -m "Phase: phase-4" \
  -m "OpenClaw-Agent-SDK-SHA: $SDK_SHA"
```

Expected: VisionClaw can now run the engine in development against the pushed SDK SHA.

### Task 9: Package The SDK Runtime For VisionClaw Publish And GUI Use

**Files:**
- Modify: `/Users/apple/programme/funny_projects/visionclaw_repo/package.json`
- Modify: `/Users/apple/programme/funny_projects/visionclaw_repo/scripts/setup-openclaw-shim.mjs`
- Create: `/Users/apple/programme/funny_projects/visionclaw_repo/scripts/stage-openclaw-agent-sdk.mjs`
- Modify: `/Users/apple/programme/funny_projects/visionclaw_repo/gui/package.json`
- Test: `/Users/apple/programme/funny_projects/visionclaw_repo/tests/unit/agent/openclaw-sdk-loader.test.ts`
- Test: `/Users/apple/programme/funny_projects/visionclaw_repo/tests/integration/openclaw-packaging.test.ts`

- [ ] **Step 1: Write the failing packaging tests**

```ts
// /Users/apple/programme/funny_projects/visionclaw_repo/tests/unit/agent/openclaw-sdk-loader.test.ts
import { describe, expect, it } from "vitest";

describe("openclaw sdk loader", () => {
  it("prefers a staged packaged runtime when the submodule is unavailable", async () => {
    expect(true).toBe(false);
  });
});
```

```ts
// /Users/apple/programme/funny_projects/visionclaw_repo/tests/integration/openclaw-packaging.test.ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("packaged OpenClaw runtime", () => {
  it("stages a publishable SDK runtime alongside VisionClaw artifacts", () => {
    const stagedRoot = path.join(process.cwd(), "dist", "vendor", "openclaw-agent-sdk");
    expect(fs.existsSync(stagedRoot)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the packaging tests and verify they fail**

Run:

```bash
cd /Users/apple/programme/funny_projects/visionclaw_repo
pnpm exec vitest run tests/unit/agent/openclaw-sdk-loader.test.ts tests/integration/openclaw-packaging.test.ts
```

Expected: FAIL because no staged runtime exists and the loader only knows about the submodule path.

- [ ] **Step 3: Add a staging script and update publish/build wiring**

```js
// /Users/apple/programme/funny_projects/visionclaw_repo/scripts/stage-openclaw-agent-sdk.mjs
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const sdkRoot = join(root, "packages", "openclaw-agent-sdk");
const stageRoot = join(root, "dist", "vendor", "openclaw-agent-sdk");

if (!existsSync(sdkRoot)) {
  throw new Error(`missing SDK submodule: ${sdkRoot}`);
}

execFileSync("pnpm", ["--dir", sdkRoot, "install"], { stdio: "inherit" });
execFileSync("pnpm", ["--dir", sdkRoot, "run", "build"], { stdio: "inherit" });

mkdirSync(stageRoot, { recursive: true });
cpSync(join(sdkRoot, "dist"), join(stageRoot, "dist"), { recursive: true });
cpSync(join(sdkRoot, "package.json"), join(stageRoot, "package.json"));
```

```json
// Update /Users/apple/programme/funny_projects/visionclaw_repo/package.json
{
  "files": [
    "dist/builtin-skills/**/*",
    "dist/tools/helpers/**/*",
    "dist/vendor/openclaw-agent-sdk/**/*",
    "dist/index.js",
    "dist/**/*",
    "dist-agent/bundle.cjs",
    "assets/**/*",
    "packages/openclaw-sdk-shim/**/*",
    "scripts/setup-openclaw-shim.mjs",
    "README.md",
    "CHANGELOG.md"
  ],
  "scripts": {
    "postinstall": "node scripts/setup-openclaw-shim.mjs",
    "build": "pnpm lint && tsc && node scripts/copy-builtin-skills.mjs && node scripts/stage-openclaw-agent-sdk.mjs && mkdir -p dist/tools/helpers && cp src/tools/helpers/*.swift dist/tools/helpers/",
    "prepublishOnly": "pnpm run check && node scripts/stage-openclaw-agent-sdk.mjs && node scripts/write-entry-shim.cjs"
  }
}
```

```js
// Replace the destination logic in /Users/apple/programme/funny_projects/visionclaw_repo/scripts/setup-openclaw-shim.mjs
const sdkStageSrc = join(root, "dist", "vendor", "openclaw-agent-sdk");
const sdkStageDest = join(root, "node_modules", "openclaw-agent-sdk");

if (!existsSync(join(sdkStageDest, "package.json")) && existsSync(sdkStageSrc)) {
  mkdirSync(sdkStageDest, { recursive: true });
  cpSync(sdkStageSrc, sdkStageDest, { recursive: true });
}
```

- [ ] **Step 4: Run the packaging tests plus a real build**

Run:

```bash
cd /Users/apple/programme/funny_projects/visionclaw_repo
pnpm exec vitest run tests/unit/agent/openclaw-sdk-loader.test.ts tests/integration/openclaw-packaging.test.ts
pnpm run build
```

Expected: tests PASS and `dist/vendor/openclaw-agent-sdk/dist/index.js` exists after the build.

- [ ] **Step 5: Commit, verify, and push the full VisionClaw integration**

Run:

```bash
SDK_SHA="$(git -C /Users/apple/programme/funny_projects/openclaw_agent_sdk rev-parse HEAD)"
git -C /Users/apple/programme/funny_projects/visionclaw_repo add package.json scripts gui/package.json tests .gitmodules packages/openclaw-agent-sdk src
git -C /Users/apple/programme/funny_projects/visionclaw_repo commit \
  -m "feat: package and publish openclaw engine integration" \
  -m "Spec: docs/superpowers/specs/2026-03-27-openclaw-agent-sdk-design.md" \
  -m "Phase: phase-5" \
  -m "OpenClaw-Agent-SDK-SHA: $SDK_SHA"
pnpm -C /Users/apple/programme/funny_projects/visionclaw_repo test
pnpm -C /Users/apple/programme/funny_projects/visionclaw_repo build
git -C /Users/apple/programme/funny_projects/visionclaw_repo push -u origin HEAD
```

Expected: VisionClaw host tests PASS, build output contains the staged SDK runtime, and the pushed commit records the exact SDK SHA it depends on.

## Rollout Checklist

- SDK repo order:
  - build/test in `/Users/apple/programme/funny_projects/openclaw_agent_sdk`
  - commit in the SDK repo
  - push to `https://github.com/babelcloud/openclaw-agent-sdk.git`
  - verify `git ls-remote` returns the same SDK SHA
- VisionClaw repo order:
  - update `packages/openclaw-agent-sdk` to the pushed SDK SHA
  - commit VisionClaw changes with `OpenClaw-Agent-SDK-SHA: <actual-sha>` footer
  - run VisionClaw tests/build
  - push VisionClaw branch
- Rollback order:
  - if the defect is SDK-only, revert in the SDK repo first and push that revert
  - then move the VisionClaw submodule pointer to the reverted or last-known-good SDK SHA in a separate VisionClaw commit
  - if the defect is host-only, revert VisionClaw commits and keep or repin the SDK SHA as required
