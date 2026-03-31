# Vendor Upstream Source — Replace PR3 Stub + PR4 Rewritten Tools

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the PR3 stub agentic loop and PR4 hand-rolled tools with production-grade vendored source from pi-mono (MIT, badlogic/pi-mono) and openclaw (MIT, openclaw/openclaw), yielding a standalone Agent SDK on par with Claude Agent SDK / OpenAI Agents SDK positioning.

**Architecture:** Vendor tool source code (TypeBox→Zod, strip TUI rendering), vendor the Anthropic streaming provider and agent loop from pi-mono, wire them into the existing PR3 session scaffold (public API, events, hosted-tool protocol, VisionClaw compat — all preserved). Gateway-coupled tools remain as hosted-tool protocol stubs only.

**Tech Stack:** TypeScript 5.7+, Zod 4, `@anthropic-ai/sdk` (Anthropic HTTP client), `diff` (BSD-3, unified diffs for edit tool), `partial-json` (streaming JSON parse for tool call args), Vitest 4, pnpm, Node >= 22.14.

---

## Evidence Chain

### Source Repos (verified 2026-03-29, all paths confirmed present)

| Repo | Local path | Remote | HEAD SHA | License |
|------|-----------|--------|----------|---------|
| pi-mono | `/Users/apple/programme/funny_projects/pi-mono` | `https://github.com/badlogic/pi-mono.git` | `cb4e4d8c` | MIT (Mario Zechner) |
| openclaw | `/Users/apple/programme/funny_projects/openclaw` | `https://github.com/openclaw/openclaw.git` | `edb5123f26` | MIT (Peter Steinberger) |

### SDK Current State (verified 2026-03-29)

| Aspect | Value |
|--------|-------|
| Current branch | `main` (HEAD at `f7d472f`, post-PR3 revert) |
| Total commits | 21 (includes PR3 merge + revert) |
| Source files | 18 SDK-authored + 16 upstream-copied (PR3 tools reverted) |
| Test files | 8 (3 contract + 5 integration), all passing |
| Only dependency | `zod ^4.3.6` |
| Uncommitted changes | 2 untracked plan docs |

### IMPORTANT: `.js` Extension Rule

`tsconfig.json` uses `moduleResolution: "Node16"`. **ALL relative imports in new files MUST use `.js` extensions:**

```typescript
// CORRECT:
import { textResult } from "../shared/tool-result.js";

// WRONG — will cause TS2835 at build time:
import { textResult } from "../shared/tool-result";
```

Existing codebase already follows this convention. Every new file must do the same.

### IMPORTANT: Zod 4 — Use Built-in JSON Schema

The SDK depends on **Zod 4.3.6** (not Zod 3). Zod 4 has a built-in `z.toJSONSchema(schema)` function. Do NOT write a custom Zod-to-JSON-Schema converter — Zod 4's internal `_def` API is incompatible with Zod 3 patterns. Always use `z.toJSONSchema()` directly.

### Upstream Tool Names (verified via grep on source, exact line numbers)

| Tool name | Source file | Line |
|-----------|-----------|------|
| `read` | pi-mono `.../tools/read.ts` | 121 |
| `write` | pi-mono `.../tools/write.ts` | 187 |
| `edit` | pi-mono `.../tools/edit.ts` | 124 |
| `exec` | openclaw `bash-tools.exec.ts` | 229 |
| `process` | openclaw `bash-tools.process.ts` | 150 |
| `web_fetch` | openclaw `tools/web-fetch.ts` | 766 |
| `web_search` | openclaw `tools/web-search.ts` | 30 |
| `browser` | openclaw `tools/browser-tool.ts` | 378 |

### What PR3 Actually Is (not what the description says)

PR3 does NOT contain an agentic loop or Anthropic provider. `sdk-session.ts:145` reads:
```ts
const reply = text ? `Acknowledged: ${text}` : "Acknowledged.";
```
PR3 is a session lifecycle scaffold with keyword-matching hosted-tool dispatch. The public API interfaces, event protocol, transcript JSONL persistence, tool policy, VisionClaw compat, logging — all correct and preserved.

### What This Plan Replaces

| Component | PR3/PR4 status | After this plan |
|-----------|---------------|-----------------|
| Agentic loop | stub echo "Acknowledged: ..." | Real Anthropic API streaming with tool loop |
| Anthropic provider | does not exist | Vendored from pi-mono anthropic.ts |
| read tool | N/A (PR4 had 60-line simplification) | Vendored from pi-mono, with paging + image |
| write tool | N/A | Vendored from pi-mono, with mkdir + queue |
| edit tool | N/A | Vendored from pi-mono, with fuzzy match + diff |
| exec tool | N/A (PR4 had "exec" as 160-line bash) | Vendored from pi-mono bash.ts renamed + openclaw background/yield |
| process tool | N/A | Vendored from openclaw, simplified |
| web_fetch | N/A (PR4 had 216-line no-SSRF version) | Vendored from openclaw with SSRF guard |
| web_search | N/A | Vendored from openclaw, single-provider |
| browser | N/A (PR4 had 499-line incomplete) | Vendored from openclaw, host-mode only |
| Tool schemas | N/A | Zod, matching upstream TypeBox schemas exactly |
| Usage tracking | chars/4 estimate | Real Anthropic API token counts |

---

## Git / Branch / PR Strategy

### Branch plan

```
main
 └── feat/vendor-upstream-tools              ← new feature branch, off main
      │
      ├── C01: chore: add vendor deps         ─── Task 1a ──── 🟢 SAFE ROLLBACK POINT
      ├── C02: chore: add provenance + sync   ─── Task 1b
      ├── C03: chore: sync raw pi-mono source ─── Task 1c ──── ⚠️ RAW (typecheck fails, expected)
      │
      ├── C04: feat: tool interface + types   ─── Task 2  ──── 🟢 SAFE ROLLBACK POINT
      │
      ├── C05: feat: anthropic types          ─── Task 3a
      ├── C06: feat: anthropic provider       ─── Task 3b ──── 🟢 SAFE ROLLBACK POINT
      │
      ├── C07: feat: agent loop types         ─── Task 4a
      ├── C08: feat: agent loop core          ─── Task 4b ──── 🟢 SAFE ROLLBACK POINT
      │
      ├── C09: feat: shared tool utilities    ─── Task 5a
      ├── C10: feat: read tool                ─── Task 5b
      ├── C11: feat: write tool               ─── Task 5c
      ├── C12: feat: edit tool + edit-diff    ─── Task 5d ──── 🟢 SAFE ROLLBACK POINT
      │
      ├── C13: feat: process registry         ─── Task 6a
      ├── C14: feat: exec tool                ─── Task 6b
      ├── C15: feat: process tool             ─── Task 6c ──── 🟢 SAFE ROLLBACK POINT
      │
      ├── C16: feat: SSRF guard               ─── Task 7a
      ├── C17: feat: web_fetch tool           ─── Task 7b
      ├── C18: feat: web_search tool          ─── Task 7c ──── 🟢 SAFE ROLLBACK POINT
      │
      ├── C19: feat: browser schema           ─── Task 8a
      ├── C20: feat: browser tool             ─── Task 8b ──── 🟢 SAFE ROLLBACK POINT
      │
      ├── C21: feat: tool assembly            ─── Task 9a
      ├── C22: feat: wire loop into session   ─── Task 9b ──── ⚠️ CRITICAL (breaks old tests)
      │
      ├── C23: test: update existing tests    ─── Task 10 ──── 🟢 SAFE ROLLBACK POINT
      │
      └── C24: chore: provenance + CI + smoke ─── Task 11 ──── 🟢 FINAL (PR-ready)
```

**24 atomic commits.** 每个 commit 只改一个逻辑单元。

### Commit 状态标记

每个 commit MUST 满足其标记的状态要求：

| 标记 | 含义 | 要求 |
|------|------|------|
| 🟢 SAFE ROLLBACK POINT | 回退到此 commit，SDK 可 build + 全部测试通过 | `pnpm run check && pnpm run build && pnpm vitest run` 全过 |
| ⚠️ CRITICAL | 此 commit 改变了核心行为，会破坏旧测试 | `pnpm run check && pnpm run build` 必须过；测试可能 fail（下一个 commit 修复） |
| 无标记 | 中间 commit，必须能编译 | `pnpm run check` 必须过 |

**规则：两个 🟢 之间的所有 commit 可以作为一组被 revert。单个 commit 也可以被独立 revert（见下方 revert 可行性表）。**

### Commit Revert 可行性矩阵

| Commit | 可以独立 `git revert`? | revert 后果 | 依赖它的后续 commit |
|--------|----------------------|------------|-------------------|
| C01 (deps) | ✅ 是，但会破坏 C05+ | 删除 `@anthropic-ai/sdk` 等依赖 | C05, C06, C22 |
| C02 (provenance) | ✅ 是 | 删除 sync 脚本和 manifest | C03, C24 |
| C03 (raw sync) | ✅ 是 | 删除 `src/tools/`, `src/loop/`, `src/providers/` 原始文件 | C04-C22 全部 |
| C04 (tool interface) | ✅ 是 | 删除 `OpenClawTool` 类型 | C10-C22 全部工具 |
| C05 (anthropic types) | ✅ 是 | 删除 provider 类型 | C06, C07, C08, C22 |
| C06 (anthropic provider) | ✅ 是 | 删除 Anthropic streaming | C22 |
| C07 (loop types) | ✅ 是 | 删除 agent loop 类型 | C08, C22 |
| C08 (loop core) | ✅ 是 | 删除 agent loop 实现 | C22 |
| C09 (shared utils) | ✅ 是 | 删除 truncate/path-utils 等 | C10, C11, C12, C14 |
| C10 (read) | ✅ 是，独立 | 删除 read 工具 | C21 (tool assembly) |
| C11 (write) | ✅ 是，独立 | 删除 write 工具 | C21 |
| C12 (edit) | ✅ 是，独立 | 删除 edit 工具 | C21 |
| C13 (registry) | ✅ 是 | 删除 process registry | C14, C15 |
| C14 (exec) | ✅ 是 | 删除 exec 工具 | C15 (process 需要 registry，但不直接依赖 exec), C21 |
| C15 (process) | ✅ 是，独立 | 删除 process 工具 | C21 |
| C16 (SSRF) | ✅ 是 | 删除 SSRF 防护 | C17 |
| C17 (web_fetch) | ✅ 是 | 删除 web_fetch | C21 |
| C18 (web_search) | ✅ 是，独立 | 删除 web_search | C21 |
| C19 (browser schema) | ✅ 是 | 删除 browser schema | C20 |
| C20 (browser) | ✅ 是，独立 | 删除 browser 工具 | C21 |
| C21 (tool assembly) | ✅ 是 | 删除工具组装（需同时 revert C22） | C22 |
| C22 (wire session) | ⚠️ 是，但必须同时 revert C21 和 C23 | 恢复 stub echo loop | C23 |
| C23 (update tests) | ⚠️ 是，但只有搭配 C22 revert 才有意义 | 恢复旧测试 | C24 |
| C24 (CI/provenance) | ✅ 是，独立 | 删除最终 CI 更新 | 无 |

### 常见回滚场景

#### 场景 1："exec 工具有 bug，其他都没问题"

```bash
# 只回退 exec 工具 + 从 tool assembly 中移除它
git revert C14  # revert exec tool
# 然后手动从 tool-assembly.ts 中注释掉 exec 的 import
git add src/tools/tool-assembly.ts
git commit -m "fix: temporarily disable exec tool pending bug fix"
```

#### 场景 2："SSRF 模块搬错了，web_fetch 也坏了"

```bash
# 回退整个 web 工具链（3 个 commit 一组）
git revert C18 C17 C16  # 按逆序 revert
# tool-assembly.ts 中注释掉 web 工具
git add src/tools/tool-assembly.ts
git commit -m "fix: temporarily disable web tools pending SSRF fix"
```

#### 场景 3："Anthropic provider 适配出问题，loop 也不能用"

```bash
# 回退到 C04（🟢 安全回滚点 — tool interface 可用，provider/loop 不存在）
git revert C22 C23  # 先恢复 stub session + 旧测试
git revert C08 C07 C06 C05  # 再删除 provider 和 loop
```

此时 SDK 回到："有工具类型和工具实现，但 session 还是 stub echo"。可以独立修复 provider 再重新提交。

#### 场景 4："整个分支搞砸了，从头来"

```bash
# 灾难恢复 — 从 main 重新开始
git checkout main
git branch -D feat/vendor-upstream-tools  # 删除本地分支
git push origin --delete feat/vendor-upstream-tools  # 删除远程分支（如已 push）
git checkout -b feat/vendor-upstream-tools  # 重新创建
# 重新按 plan 执行
```

#### 场景 5："C22 wiring 破坏了旧测试，需要临时回退到可工作状态"

```bash
# C22 是 ⚠️ CRITICAL — 回退它 + C21 就恢复 stub loop
git revert C22 C21
# SDK 回到：所有工具已 vendor，但 session 还是 stub echo
# 全部测试应该通过（恢复到 C20 🟢 安全点的行为）
```

### Commit 编号与 git tag

每个 🟢 安全回滚点，commit 后立即打轻量 tag：

```bash
# 在 C03 commit 后
git tag vendor/raw-sync

# 在 C04 commit 后
git tag vendor/tool-interface

# 在 C06 commit 后
git tag vendor/anthropic-provider

# 在 C08 commit 后
git tag vendor/agent-loop

# 在 C12 commit 后
git tag vendor/file-tools

# 在 C15 commit 后
git tag vendor/exec-tools

# 在 C18 commit 后
git tag vendor/web-tools

# 在 C20 commit 后
git tag vendor/browser-tool

# 在 C23 commit 后
git tag vendor/tests-updated

# 在 C24 commit 后
git tag vendor/complete
```

回滚到任意安全点：`git reset --hard vendor/file-tools`（回到文件工具完成、exec 工具还没开始的状态）。

### Commit 规则

- Prefix: `feat:`, `refactor:`, `test:`, `chore:`, `docs:`
- Every commit message MUST end with:
  ```
  Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
  ```
- **🟢 commit**: MUST pass `pnpm run check && pnpm run build && pnpm vitest run` before committing
- **无标记 commit**: MUST pass `pnpm run check` before committing
- **⚠️ commit**: MUST pass `pnpm run check && pnpm run build` before committing; test failures expected and documented
- Stage specific files, never `git add -A`
- If a commit fails its verification level, DO NOT commit. Fix first.

### PR rules

- **One PR** for the entire vendor effort, titled: `refactor: vendor upstream tools and anthropic provider, replace stub loop`
- PR body must list:
  - All vendored files with source repo + SHA
  - Deleted files (any PR4 tool files being replaced)
  - New dependencies added
  - Test results
  - List of all 🟢 safe rollback points with their tags
- PR targets `main`
- PR must pass ALL gate conditions (see Section D)
- Do NOT force push. History stays linear. Tags preserved.

### When to push

- Push after every 🟢 safe rollback point (with its tag)
- Push tags: `git push origin --tags`
- Always push before creating the PR
- Use `git push -u origin feat/vendor-upstream-tools` on first push

### Push schedule

| After commit | Push? | Tags to push |
|-------------|-------|-------------|
| C03 (🟢) | Yes | `vendor/raw-sync` |
| C04 (🟢) | Yes | `vendor/tool-interface` |
| C06 (🟢) | Yes | `vendor/anthropic-provider` |
| C08 (🟢) | Yes | `vendor/agent-loop` |
| C12 (🟢) | Yes | `vendor/file-tools` |
| C15 (🟢) | Yes | `vendor/exec-tools` |
| C18 (🟢) | Yes | `vendor/web-tools` |
| C20 (🟢) | Yes | `vendor/browser-tool` |
| C23 (🟢) | Yes | `vendor/tests-updated` |
| C24 (🟢) | Yes | `vendor/complete` |

---

## File Structure

### New files to create

```
src/
├── providers/                           # Anthropic streaming (vendored from pi-mono/packages/ai)
│   ├── anthropic.ts                     # ~800 lines (pi-mono anthropic.ts minus stealth/copilot)
│   ├── anthropic-types.ts               # ~250 lines (subset of pi-mono ai/types.ts)
│   ├── event-stream.ts                  # 88 lines (pi-mono utils/event-stream.ts)
│   ├── json-parse.ts                    # 28 lines (pi-mono utils/json-parse.ts)
│   ├── sanitize-unicode.ts              # 25 lines (pi-mono utils/sanitize-unicode.ts)
│   ├── simple-options.ts                # 47 lines (pi-mono providers/simple-options.ts)
│   ├── transform-messages.ts            # 173 lines (pi-mono providers/transform-messages.ts)
│   └── env-api-keys.ts                  # ~50 lines (simplified from pi-mono, anthropic-only)
│
├── loop/                                # Agent loop (vendored from pi-mono/packages/agent)
│   ├── agent-loop.ts                    # ~500 lines (pi-mono agent-loop.ts, trimmed)
│   └── agent-types.ts                   # ~200 lines (subset of pi-mono agent/types.ts)
│
├── tools/                               # SDK tool interface and assembly
│   ├── tool-interface.ts                # ~60 lines (OpenClawTool type, Zod→Anthropic converter)
│   ├── tool-assembly.ts                 # ~100 lines (assembles all tools for a session)
│   │
│   ├── file/                            # File tools (vendored from pi-mono coding-agent)
│   │   ├── read.ts                      # ~150 lines (minus TUI, TypeBox→Zod)
│   │   ├── write.ts                     # ~80 lines
│   │   ├── edit.ts                      # ~180 lines
│   │   └── edit-diff.ts                 # ~300 lines (fuzzy match + unified diff, direct copy)
│   │
│   ├── exec/                            # Exec tools (pi-mono bash + openclaw extensions)
│   │   ├── exec.ts                      # ~350 lines (bash.ts renamed + background/yield)
│   │   ├── process.ts                   # ~300 lines (simplified from openclaw)
│   │   └── process-registry.ts          # ~200 lines (simplified from openclaw)
│   │
│   ├── web/                             # Web tools (vendored from openclaw)
│   │   ├── web-fetch.ts                 # ~400 lines (minus config chain)
│   │   ├── web-fetch-utils.ts           # ~260 lines (HTML extraction)
│   │   ├── web-search.ts                # ~200 lines (single Brave provider)
│   │   ├── ssrf.ts                      # ~350 lines (from openclaw infra/net/ssrf.ts)
│   │   └── fetch-guard.ts              # ~200 lines (from openclaw infra/net/fetch-guard.ts)
│   │
│   ├── browser/                         # Browser tool (vendored from openclaw, host-mode only)
│   │   ├── browser.ts                   # ~400 lines (minus sandbox/node)
│   │   ├── browser-schema.ts            # ~140 lines (direct copy)
│   │   └── browser-actions.ts           # ~350 lines (minus node proxy)
│   │
│   └── shared/                          # Shared utilities (vendored from pi-mono)
│       ├── truncate.ts                  # 265 lines (direct copy)
│       ├── path-utils.ts               # 94 lines (direct copy)
│       ├── file-mutation-queue.ts       # 39 lines (direct copy)
│       ├── shell.ts                     # ~80 lines (simplified from pi-mono)
│       ├── child-process.ts             # 86 lines (direct copy)
│       ├── mime.ts                      # 30 lines (direct copy)
│       └── tool-result.ts              # ~80 lines (textResult/jsonResult/imageResult helpers)
│
tests/
├── unit/                                # New unit test directory
│   ├── tools/
│   │   ├── read.test.ts
│   │   ├── write.test.ts
│   │   ├── edit.test.ts
│   │   ├── exec.test.ts
│   │   └── tool-interface.test.ts
│   ├── providers/
│   │   └── anthropic.test.ts
│   └── loop/
│       └── agent-loop.test.ts
│
scripts/
├── sync-from-pi-mono.mjs               # New sync script for pi-mono provenance
│
manifests/
├── pi-mono-provenance.json              # New provenance manifest for pi-mono files
```

### Files to modify

```
src/core/embedded-runner/sdk-session.ts   # Replace stub echo with real agentic loop call
src/core/embedded-runner/sdk-factory.ts   # Add tool assembly to session creation
src/public/sdk.ts                         # Add anthropicApiKey to SdkOptions
src/public/types.ts                       # Add anthropicApiKey field
package.json                              # Add 3 new dependencies
tsconfig.json                             # Include new directories
manifests/upstream-provenance.json        # Add pi-mono entries
```

### Files preserved unchanged

```
src/public/events.ts                      # No change
src/public/session.ts                     # No change
src/public/host-tools.ts                  # No change
src/public/persistence.ts                 # No change
src/index.ts                              # No change
src/core/tools/tool-policy.ts             # No change
src/core/normalization/upstream-events.ts  # No change
src/core/plugins/plugin-runtime.ts        # No change
src/core/sessions/session-store.ts        # No change
src/core/logging/host-logger.ts           # No change
src/compat/visionclaw/*                   # All 4 files unchanged
src/upstream/openclaw/*                   # All 16 files unchanged (reference only)
```

---

## Task 1: Bootstrap — Dependencies, Provenance, Branch

**Files:**
- Modify: `package.json`
- Create: `manifests/pi-mono-provenance.json`
- Create: `scripts/sync-from-pi-mono.mjs`

- [ ] **Step 1: Create feature branch from main**

```bash
cd /Users/apple/programme/funny_projects/openclaw_agent_sdk
git checkout main
git pull origin main
git checkout -b feat/vendor-upstream-tools
```

- [ ] **Step 2: Add new dependencies**

```bash
pnpm add @anthropic-ai/sdk@^0.80.0
pnpm add diff@^7.0.0
pnpm add partial-json@^0.1.7
```

Verify `package.json` now has 4 dependencies:
```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.80.0",
    "diff": "^7.0.0",
    "partial-json": "^0.1.7",
    "zod": "^4.3.6"
  }
}
```

- [ ] **Step 3: Create pi-mono provenance manifest**

```json
{
  "version": 1,
  "sourceRepo": "https://github.com/badlogic/pi-mono.git",
  "license": "MIT",
  "upstreamSha": "cb4e4d8c",
  "entries": []
}
```

Save to `manifests/pi-mono-provenance.json`. Entries will be populated as files are vendored in subsequent tasks.

- [ ] **Step 4: Create pi-mono sync script**

Create `scripts/sync-from-pi-mono.mjs` — a CLI tool that copies files from the local pi-mono checkout into `src/` and updates the provenance manifest. This mirrors the existing `sync-from-openclaw.mjs` pattern.

```javascript
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const PI_MONO_ROOT = "/Users/apple/programme/funny_projects/pi-mono";
const MANIFEST_PATH = "manifests/pi-mono-provenance.json";

// File map: source (relative to PI_MONO_ROOT) -> destination (relative to repo root)
const FILE_MAP = {
  // tools
  "packages/coding-agent/src/core/tools/read.ts": "src/tools/file/read.ts",
  "packages/coding-agent/src/core/tools/write.ts": "src/tools/file/write.ts",
  "packages/coding-agent/src/core/tools/edit.ts": "src/tools/file/edit.ts",
  "packages/coding-agent/src/core/tools/edit-diff.ts": "src/tools/file/edit-diff.ts",
  "packages/coding-agent/src/core/tools/bash.ts": "src/tools/exec/exec.ts",
  "packages/coding-agent/src/core/tools/truncate.ts": "src/tools/shared/truncate.ts",
  "packages/coding-agent/src/core/tools/path-utils.ts": "src/tools/shared/path-utils.ts",
  "packages/coding-agent/src/core/tools/file-mutation-queue.ts": "src/tools/shared/file-mutation-queue.ts",
  // utils
  "packages/coding-agent/src/utils/shell.ts": "src/tools/shared/shell.ts",
  "packages/coding-agent/src/utils/child-process.ts": "src/tools/shared/child-process.ts",
  "packages/coding-agent/src/utils/mime.ts": "src/tools/shared/mime.ts",
  // agent loop
  "packages/agent/src/agent-loop.ts": "src/loop/agent-loop.ts",
  "packages/agent/src/types.ts": "src/loop/agent-types.ts",
  // anthropic provider
  "packages/ai/src/providers/anthropic.ts": "src/providers/anthropic.ts",
  "packages/ai/src/providers/simple-options.ts": "src/providers/simple-options.ts",
  "packages/ai/src/providers/transform-messages.ts": "src/providers/transform-messages.ts",
  "packages/ai/src/utils/event-stream.ts": "src/providers/event-stream.ts",
  "packages/ai/src/utils/json-parse.ts": "src/providers/json-parse.ts",
  "packages/ai/src/utils/sanitize-unicode.ts": "src/providers/sanitize-unicode.ts",
  "packages/ai/src/types.ts": "src/providers/anthropic-types.ts",
  "packages/ai/src/env-api-keys.ts": "src/providers/env-api-keys.ts",
};

console.log("Syncing from pi-mono...");
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
manifest.entries = [];

for (const [src, dest] of Object.entries(FILE_MAP)) {
  const srcPath = path.join(PI_MONO_ROOT, src);
  if (!fs.existsSync(srcPath)) {
    console.error(`MISSING: ${srcPath}`);
    process.exit(1);
  }
  const destDir = path.dirname(dest);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(srcPath, dest);
  manifest.entries.push({
    upstream: src,
    destination: dest,
    mode: "adapted",
    adaptations: ["pending — see task-specific commits"],
  });
  console.log(`  ${src} -> ${dest}`);
}

fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Manifest updated: ${manifest.entries.length} entries`);
```

- [ ] **Step 5: Run sync to copy raw source files**

```bash
node scripts/sync-from-pi-mono.mjs
```

Expected: 22 files copied, manifest updated. These are RAW copies — they won't compile yet. That's intentional; subsequent tasks adapt them.

- [ ] **Step 6: Verify files exist**

```bash
ls src/tools/file/read.ts src/tools/file/edit-diff.ts src/loop/agent-loop.ts src/providers/anthropic.ts
```

All 4 must exist.

- [ ] **Step 7: Commit C01 — dependencies only (🟢 SAFE ROLLBACK POINT)**

```bash
git add package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore: add vendor dependencies (@anthropic-ai/sdk, diff, partial-json)

Add @anthropic-ai/sdk ^0.80.0, diff ^7.0.0, partial-json ^0.1.7.
These are needed by vendored Anthropic provider and tools.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Verification C01:**
```bash
pnpm run check && pnpm run build && pnpm vitest run  # must all pass — no source changes
```

- [ ] **Step 8: Commit C02 — provenance scaffold**

```bash
git add manifests/pi-mono-provenance.json scripts/sync-from-pi-mono.mjs
git commit -m "$(cat <<'EOF'
chore: add pi-mono provenance manifest and sync script

Mirrors existing sync-from-openclaw.mjs pattern.
Manifest tracks 22 files from badlogic/pi-mono @ cb4e4d8c.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Verification C02:**
```bash
pnpm run check  # must pass — scripts are not compiled
```

- [ ] **Step 9: Commit C03 — raw source sync (🟢 SAFE ROLLBACK POINT)**

```bash
git add src/tools/ src/loop/ src/providers/
git commit -m "$(cat <<'EOF'
chore: sync raw pi-mono source (22 files, unadapted)

Raw TypeScript copies from pi-mono. These files will NOT compile
(excluded via tsconfig "src/upstream/**/*" pattern — but these are
in src/tools/, src/loop/, src/providers/ so they ARE included).
Subsequent commits adapt imports and schemas.

Source: https://github.com/badlogic/pi-mono @ cb4e4d8c
License: MIT (Mario Zechner)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
git tag vendor/raw-sync
```

**Verification C03:** `pnpm run check` will FAIL (raw files have broken imports). This is expected and documented. The tag marks the raw state for provenance audit.

**⚠️ Exception to commit rule:** C03 is allowed to fail typecheck because the raw files are intentionally unadapted. The NEXT 🟢 safe point (C04) must restore typecheck. To verify the raw files at least exist:
```bash
test -f src/tools/file/read.ts && test -f src/loop/agent-loop.ts && test -f src/providers/anthropic.ts && echo "PASS: all raw files present" || echo "FAIL"
```

- [ ] **Step 10: Push C01-C03 + tag**

```bash
git push -u origin feat/vendor-upstream-tools
git push origin --tags
```

---

## Task 2: Tool Interface and Shared Types

**Files:**
- Create: `src/tools/tool-interface.ts`
- Create: `src/tools/shared/tool-result.ts`

- [ ] **Step 1: Write test for tool interface**

Create `tests/unit/tools/tool-interface.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { z } from "zod";

// These imports will fail until Step 3
import {
  type OpenClawTool,
  type OpenClawToolResult,
  toAnthropicToolDef,
} from "../../../src/tools/tool-interface.js";
import { textResult, jsonResult } from "../../../src/tools/shared/tool-result.js";

describe("OpenClawTool interface", () => {
  const mockTool: OpenClawTool = {
    name: "test_tool",
    description: "A test tool",
    parameters: z.object({ input: z.string() }),
    execute: async (_callId, _params) => textResult("ok"),
  };

  it("converts to Anthropic tool definition", () => {
    const def = toAnthropicToolDef(mockTool);
    expect(def.name).toBe("test_tool");
    expect(def.description).toBe("A test tool");
    expect(def.input_schema).toHaveProperty("type", "object");
    expect(def.input_schema).toHaveProperty("properties");
    expect((def.input_schema as any).properties.input).toHaveProperty("type", "string");
  });
});

describe("tool result helpers", () => {
  it("textResult produces correct structure", () => {
    const result = textResult("hello");
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({ type: "text", text: "hello" });
  });

  it("jsonResult stringifies object", () => {
    const result = jsonResult({ status: "ok", count: 3 });
    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(JSON.parse(text)).toEqual({ status: "ok", count: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/unit/tools/tool-interface.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement tool-interface.ts**

Create `src/tools/tool-interface.ts`:

```typescript
import type { Tool } from "@anthropic-ai/sdk/resources/messages.js";
import { z } from "zod";

/**
 * Result returned by tool execution.
 * Content array matches Anthropic's ToolResultBlockParam content format.
 */
export interface OpenClawToolResult {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  >;
}

/**
 * SDK-native tool definition. All vendored tools implement this interface.
 * Parameters use Zod schemas (not TypeBox).
 */
export interface OpenClawTool {
  name: string;
  description: string;
  parameters: z.ZodType<any>;
  execute(
    callId: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<OpenClawToolResult>;
}

/**
 * Convert an SDK tool to the Anthropic API tool definition format.
 */
export function toAnthropicToolDef(tool: OpenClawTool): Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: z.toJSONSchema(tool.parameters) as Tool["input_schema"],
  };
}
```

**NOTE:** Zod 4 has a built-in `z.toJSONSchema()` function. Do NOT write a custom converter — it would break on Zod 4's internal API (which differs from Zod 3). Use the built-in directly.

No `src/tools/zod-to-json-schema.ts` file needed.

Create `src/tools/shared/tool-result.ts`:

```typescript
import type { OpenClawToolResult } from "../tool-interface.js";

export function textResult(text: string): OpenClawToolResult {
  return { content: [{ type: "text", text }] };
}

export function jsonResult(data: unknown): OpenClawToolResult {
  return textResult(
    typeof data === "string" ? data : JSON.stringify(data, null, 2),
  );
}

export function failedTextResult(message: string): OpenClawToolResult {
  return textResult(`Error: ${message}`);
}

export function imageResult(data: string, mimeType: string): OpenClawToolResult {
  return {
    content: [
      {
        type: "image",
        source: { type: "base64", media_type: mimeType, data },
      },
    ],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run tests/unit/tools/tool-interface.test.ts
```

Expected: PASS (all 3 tests).

- [ ] **Step 5: Run typecheck**

```bash
pnpm run check
```

Expected: PASS (no type errors in new files).

- [ ] **Step 6: Commit C04 (🟢 SAFE ROLLBACK POINT)**

```bash
git add src/tools/tool-interface.ts src/tools/shared/tool-result.ts tests/unit/tools/tool-interface.test.ts
git commit -m "$(cat <<'EOF'
feat: add SDK-native tool interface and result helpers

OpenClawTool interface with Zod schemas. toAnthropicToolDef() converts
to Anthropic API format. textResult/jsonResult/imageResult helpers
for tool return values.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
git tag vendor/tool-interface
```

**Verification C04:**
```bash
pnpm run check && pnpm run build && pnpm vitest run  # ALL must pass
grep -r "@mariozechner" src/tools/tool-interface.ts src/tools/shared/tool-result.ts | wc -l  # must be 0
```

- [ ] **Step 7: Push C04 + tag**

```bash
git push && git push origin --tags
```

---

## Task 3: Adapt Anthropic Provider

**Files:**
- Modify: `src/providers/anthropic.ts` (raw copy from Task 1)
- Modify: `src/providers/anthropic-types.ts` (raw copy from Task 1)
- Modify: `src/providers/env-api-keys.ts` (raw copy from Task 1)
- Keep as-is: `src/providers/event-stream.ts`, `json-parse.ts`, `sanitize-unicode.ts`, `simple-options.ts`, `transform-messages.ts`

- [ ] **Step 1: Adapt anthropic-types.ts**

Open `src/providers/anthropic-types.ts` (raw copy of pi-mono `ai/types.ts`). Apply these changes:

1. Remove the `import type { TSchema } from "@sinclair/typebox"` import
2. Replace `TSchema` with `any` in the `Tool` interface: `interface Tool<TParameters = any>`
3. Remove all compat types (`OpenAICompletionsCompat`, `OpenAIResponsesCompat`, `OpenRouterRouting`, `VercelGatewayRouting`)
4. Remove non-Anthropic `KnownApi` entries, keep only `"anthropic-messages"`
5. Remove non-Anthropic `KnownProvider` entries, keep only `"anthropic"`
6. Keep all content types (TextContent, ThinkingContent, ImageContent, ToolCall), message types, Usage, StopReason, StreamOptions, SimpleStreamOptions, AssistantMessageEvent, Context, Model

- [ ] **Step 2: Adapt env-api-keys.ts**

Replace the full file content with a simplified version that only handles Anthropic:

```typescript
export function getEnvApiKey(provider: string): string | undefined {
  if (provider === "anthropic") {
    return process.env.ANTHROPIC_API_KEY;
  }
  return undefined;
}
```

- [ ] **Step 3: Adapt anthropic.ts**

Open `src/providers/anthropic.ts` (raw copy). Apply these changes:

1. Update imports to point to local files (`../providers/anthropic-types.js` instead of `../types.js`)
2. **Delete stealth mode** (lines 64-101): Remove `claudeCodeVersion`, `claudeCodeTools`, `ccToolLookup`, `toClaudeCodeName`, `fromClaudeCodeName`
3. **Delete copilot branch** in `createClient`: Remove the `if (model.provider === "github-copilot")` block
4. **Delete OAuth/Claude Code identity**: In `buildParams`, remove the `if (isOAuthToken)` branch that injects "You are Claude Code" system prompt. Keep only the standard system prompt path.
5. In `convertMessages`, remove all `isOAuth` parameter usage and `toClaudeCodeName`/`fromClaudeCodeName` calls — always use tool names as-is.
6. In `convertTools`, remove the `isOAuth` rename logic.
7. Update all internal imports to use the adapted local files.

- [ ] **Step 4: Fix remaining import paths in simple-options.ts, transform-messages.ts**

Update `../types.js` imports in these files to `./anthropic-types.js`.

- [ ] **Step 5: Fix event-stream.ts, json-parse.ts, sanitize-unicode.ts imports**

Update their imports to use local relative paths.

- [ ] **Step 6: Run typecheck**

```bash
pnpm run check
```

Fix any remaining type errors. The goal is all provider files compile cleanly.

- [ ] **Step 7: Write basic provider test**

Create `tests/unit/providers/anthropic.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { AssistantMessageEventStream } from "../../../src/providers/event-stream.js";
import { parseStreamingJson } from "../../../src/providers/json-parse.js";
import { sanitizeSurrogates } from "../../../src/providers/sanitize-unicode.js";

describe("provider utilities", () => {
  it("AssistantMessageEventStream is iterable", () => {
    const stream = new AssistantMessageEventStream();
    expect(stream[Symbol.asyncIterator]).toBeDefined();
  });

  it("parseStreamingJson handles partial JSON", () => {
    expect(parseStreamingJson('{"a": 1')).toEqual({ a: 1 });
    expect(parseStreamingJson("")).toEqual({});
  });

  it("sanitizeSurrogates removes unpaired surrogates", () => {
    expect(sanitizeSurrogates("hello")).toBe("hello");
    expect(sanitizeSurrogates("hello\uD800world")).toBe("helloworld");
  });
});
```

- [ ] **Step 8: Run tests**

```bash
pnpm vitest run tests/unit/providers/anthropic.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit C05 — anthropic types**

```bash
git add src/providers/anthropic-types.ts src/providers/env-api-keys.ts src/providers/sanitize-unicode.ts src/providers/json-parse.ts src/providers/event-stream.ts
git commit -m "$(cat <<'EOF'
feat: adapt anthropic types and provider utilities from pi-mono

Subset of pi-ai types for Anthropic-only use. Removed @sinclair/typebox
dependency (replaced TSchema with any). Simplified env-api-keys to
anthropic-only. Event stream, JSON parse, surrogate sanitize unchanged.

Source: pi-mono @ cb4e4d8c (MIT)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Verification C05:**
```bash
pnpm run check  # must pass
grep -r "@sinclair/typebox" src/providers/ | wc -l  # must be 0
grep -r "@mariozechner" src/providers/ | wc -l  # must be 0
```

- [ ] **Step 10: Commit C06 — anthropic provider (🟢 SAFE ROLLBACK POINT)**

```bash
git add src/providers/anthropic.ts src/providers/simple-options.ts src/providers/transform-messages.ts tests/unit/providers/
git commit -m "$(cat <<'EOF'
feat: adapt anthropic streaming provider from pi-mono

Streaming Messages API with extended thinking (adaptive Opus 4.6/
Sonnet 4.6, budget-based older models), cache control, streaming
JSON tool call parsing.

Removed: stealth mode, OAuth/Claude Code identity, GitHub Copilot.

Source: pi-mono @ cb4e4d8c (MIT)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
git tag vendor/anthropic-provider
```

**Verification C06:**
```bash
pnpm run check && pnpm run build && pnpm vitest run  # ALL must pass
grep -r "@mariozechner" src/providers/ | wc -l  # must be 0
grep -r "claudeCodeVersion\|claudeCodeTools\|toClaudeCodeName" src/providers/ | wc -l  # must be 0 (stealth removed)
grep -r "github-copilot" src/providers/ | wc -l  # must be 0
```

- [ ] **Step 11: Push C05-C06 + tag**

```bash
git push && git push origin --tags
```

---

## Task 4: Adapt Agent Loop

**Files:**
- Modify: `src/loop/agent-loop.ts` (raw copy from Task 1)
- Modify: `src/loop/agent-types.ts` (raw copy from Task 1)

- [ ] **Step 1: Adapt agent-types.ts**

Open `src/loop/agent-types.ts` (raw copy of pi-mono `agent/types.ts`). Apply:

1. Replace `import ... from "@mariozechner/pi-ai"` with imports from `../providers/anthropic-types.js`
2. Keep: `AgentTool`, `AgentToolResult`, `AgentToolUpdateCallback`, `AgentToolCall`, `AgentContext`, `AgentLoopConfig`, `AgentEvent`, `AgentState`, `AgentMessage`, `StreamFn`, `ToolExecutionMode`, `BeforeToolCallResult`, `AfterToolCallResult`, `BeforeToolCallContext`, `AfterToolCallContext`, `ThinkingLevel`, `CustomAgentMessages`
3. Remove: `getDefaultModel()` call and import (it references `@mariozechner/pi-ai` model registry)

- [ ] **Step 2: Adapt agent-loop.ts**

Open `src/loop/agent-loop.ts`. Apply:

1. Replace `import ... from "@mariozechner/pi-ai"` with imports from `../providers/anthropic-types.js` and `../providers/event-stream.js`
2. Replace `import { streamSimple } from "@mariozechner/pi-ai"` — the `streamFn` is now passed in via config, not imported
3. Replace `import { validateToolArguments } from "@mariozechner/pi-ai"` — implement inline or import from a local validator
4. Update all type references to local paths
5. Keep the full loop logic: outer loop (follow-ups), inner loop (tool calls), parallel/sequential tool dispatch, beforeToolCall/afterToolCall hooks, abort signal threading

- [ ] **Step 3: Create minimal tool argument validator**

Add to `src/loop/agent-loop.ts` or a separate file:

```typescript
function validateToolArguments(
  tool: AgentTool<any>,
  toolCall: AgentToolCall,
): unknown {
  // For now, pass through — Zod validation happens at tool.execute() level
  return toolCall.arguments;
}
```

- [ ] **Step 4: Run typecheck**

```bash
pnpm run check
```

Fix any remaining type errors.

- [ ] **Step 5: Write agent loop test**

Create `tests/unit/loop/agent-loop.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { AgentTool, AgentEvent, AgentLoopConfig } from "../../src/loop/agent-types.js";

describe("agent loop types", () => {
  it("AgentEvent type exists and has known shapes", () => {
    const startEvent: AgentEvent = { type: "agent_start" };
    expect(startEvent.type).toBe("agent_start");

    const endEvent: AgentEvent = { type: "agent_end", messages: [] };
    expect(endEvent.type).toBe("agent_end");
  });
});
```

- [ ] **Step 6: Run tests**

```bash
pnpm vitest run tests/unit/loop/
```

Expected: PASS.

- [ ] **Step 7: Commit C07 — agent loop types**

```bash
git add src/loop/agent-types.ts
git commit -m "$(cat <<'EOF'
feat: adapt agent loop types from pi-mono

AgentTool, AgentToolResult, AgentEvent, AgentLoopConfig interfaces.
Removed pi-ai model registry dependency.

Source: pi-mono @ cb4e4d8c (MIT)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Verification C07:**
```bash
pnpm run check  # must pass
grep -r "@mariozechner" src/loop/ | wc -l  # must be 0
```

- [ ] **Step 8: Commit C08 — agent loop core (🟢 SAFE ROLLBACK POINT)**

```bash
git add src/loop/agent-loop.ts tests/unit/loop/
git commit -m "$(cat <<'EOF'
feat: adapt agent loop core from pi-mono

Agentic tool-dispatch loop with parallel/sequential execution,
beforeToolCall/afterToolCall hooks, steering/follow-up messages,
abort signal propagation.

Source: pi-mono @ cb4e4d8c (MIT)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
git tag vendor/agent-loop
```

**Verification C08:**
```bash
pnpm run check && pnpm run build && pnpm vitest run  # ALL must pass
grep -r "@mariozechner" src/loop/ | wc -l  # must be 0
```

- [ ] **Step 9: Push C07-C08 + tag**

```bash
git push && git push origin --tags
```

---

## Task 5: Adapt File Tools (read, write, edit)

**Files:**
- Modify: `src/tools/file/read.ts`, `write.ts`, `edit.ts` (raw copies from Task 1)
- Keep as-is: `src/tools/file/edit-diff.ts` (only needs import path fix)
- Modify: `src/tools/shared/truncate.ts`, `path-utils.ts`, `file-mutation-queue.ts`, `mime.ts`, `shell.ts`, `child-process.ts` (raw copies)

- [ ] **Step 1: Adapt shared utilities first**

For each file in `src/tools/shared/`:

- `truncate.ts`: Remove all TUI imports (`@mariozechner/pi-tui`). Keep the pure logic: `truncateHead`, `truncateTail`, `truncateLine`, constants `DEFAULT_MAX_LINES`, `DEFAULT_MAX_BYTES`, `GREP_MAX_LINE_LENGTH`. No other changes needed.
- `path-utils.ts`: Remove TUI imports. Keep `expandPath`, `resolveToCwd`, `resolveReadPath`. No config dependency.
- `file-mutation-queue.ts`: No changes needed (pure Node.js `fs.realpathSync` + Map).
- `mime.ts`: Keep as-is. Depends on `file-type` npm package — add it as optional or inline the magic byte check.
- `shell.ts`: Remove pi-mono config imports (`../config.js`, `SettingsManager`). Replace `getShellConfig()` to use environment or defaults: check `SHELL` env var, fall back to `/bin/bash` or `/bin/sh`. Remove `getBinDir()` — SDK tools find `rg`/`fd` in PATH.
- `child-process.ts`: No changes needed (pure Node.js `child_process`).

- [ ] **Step 2: Adapt edit-diff.ts**

Open `src/tools/file/edit-diff.ts`. Only change: update the `diff` import to use the npm package directly (it should already be `import * as Diff from "diff"` — verify and fix if needed). Remove any TUI rendering imports. Keep all fuzzy matching and diff generation logic.

- [ ] **Step 3: Adapt read.ts**

Open `src/tools/file/read.ts`. Apply:

1. Remove all TUI imports (`@mariozechner/pi-tui`, `render-utils`, theme, keybinding)
2. Remove `createReadToolDefinition` (TUI version) — keep only `createReadTool`
3. Replace TypeBox schema with Zod:
```typescript
import { z } from "zod";
const readSchema = z.object({
  path: z.string().describe("Path to the file to read (relative or absolute)"),
  offset: z.number().optional().describe("Line number to start reading from (1-indexed)"),
  limit: z.number().optional().describe("Maximum number of lines to read"),
});
```
4. Replace `AgentTool` return type with `OpenClawTool`
5. Keep: `ReadOperations` interface, pluggable operations pattern, image detection, truncation logic
6. Update imports to local shared utilities

- [ ] **Step 4: Adapt write.ts**

Same pattern as read.ts:
1. Remove TUI imports and `createWriteToolDefinition`
2. Replace TypeBox → Zod schema
3. Replace AgentTool → OpenClawTool
4. Keep: `WriteOperations`, auto-mkdir, `withFileMutationQueue`

- [ ] **Step 5: Adapt edit.ts**

Same pattern:
1. Remove TUI imports and `createEditToolDefinition`
2. Replace TypeBox → Zod schema
3. Replace AgentTool → OpenClawTool
4. Keep: `EditOperations`, fuzzy matching via `edit-diff.ts`, uniqueness check, diff output

- [ ] **Step 6: Write file tool tests**

Create `tests/unit/tools/read.test.ts`:

```typescript
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
});
```

Create `tests/unit/tools/write.test.ts` and `tests/unit/tools/edit.test.ts` with similar patterns.

- [ ] **Step 7: Run tests**

```bash
pnpm vitest run tests/unit/tools/
```

Expected: PASS.

- [ ] **Step 8: Run typecheck**

```bash
pnpm run check
```

- [ ] **Step 9: Commit C09 — shared tool utilities**

```bash
git add src/tools/shared/
git commit -m "$(cat <<'EOF'
feat: adapt shared tool utilities from pi-mono

truncate (2000 lines/50KB), path-utils (macOS NFD), file-mutation-queue,
shell (simplified, SHELL env var), child-process, mime detection.
Stripped pi-mono config imports.

Source: pi-mono @ cb4e4d8c (MIT)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Verification C09:**
```bash
pnpm run check  # must pass
grep -r "@mariozechner\|pi-tui\|SettingsManager\|getBinDir" src/tools/shared/ | wc -l  # must be 0
```

- [ ] **Step 10: Commit C10 — read tool**

```bash
git add src/tools/file/read.ts tests/unit/tools/read.test.ts
git commit -m "$(cat <<'EOF'
feat: vendor read tool from pi-mono

TypeBox→Zod, stripped TUI. Preserved: ReadOperations interface,
image MIME detection, offset/limit paging, truncation.

Source: pi-mono @ cb4e4d8c (MIT)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Verification C10:**
```bash
pnpm run check  # must pass
pnpm vitest run tests/unit/tools/read.test.ts  # must pass
```

- [ ] **Step 11: Commit C11 — write tool**

```bash
git add src/tools/file/write.ts tests/unit/tools/write.test.ts
git commit -m "$(cat <<'EOF'
feat: vendor write tool from pi-mono

TypeBox→Zod, stripped TUI. Preserved: WriteOperations interface,
auto-mkdir, withFileMutationQueue serialization.

Source: pi-mono @ cb4e4d8c (MIT)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Verification C11:**
```bash
pnpm run check  # must pass
pnpm vitest run tests/unit/tools/write.test.ts  # must pass
```

- [ ] **Step 12: Commit C12 — edit tool + edit-diff (🟢 SAFE ROLLBACK POINT)**

```bash
git add src/tools/file/edit.ts src/tools/file/edit-diff.ts tests/unit/tools/edit.test.ts
git commit -m "$(cat <<'EOF'
feat: vendor edit tool + fuzzy matching from pi-mono

TypeBox→Zod, stripped TUI. Preserved: EditOperations, fuzzy matching
(Unicode NFKC, smart quotes, trailing whitespace), uniqueness check,
unified diff output via 'diff' package.

Source: pi-mono @ cb4e4d8c (MIT)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
git tag vendor/file-tools
```

**Verification C12:**
```bash
pnpm run check && pnpm run build && pnpm vitest run  # ALL must pass
grep -r "@mariozechner\|pi-tui\|@sinclair" src/tools/file/ | wc -l  # must be 0
# Schema alignment:
pnpm vitest run tests/unit/tools/schema-alignment.test.ts  # must pass
```

- [ ] **Step 13: Push C09-C12 + tag**

```bash
git push && git push origin --tags
```

---

## Task 6: Adapt exec + process Tools

**Files:**
- Modify: `src/tools/exec/exec.ts` (raw copy of pi-mono bash.ts from Task 1)
- Create: `src/tools/exec/process.ts`
- Create: `src/tools/exec/process-registry.ts`

- [ ] **Step 1: Adapt exec.ts from bash.ts**

Open `src/tools/exec/exec.ts` (raw copy of pi-mono `bash.ts`). Apply:

1. Remove TUI imports and `createBashToolDefinition`
2. **Rename tool**: Change `name: "bash"` to `name: "exec"`
3. Replace TypeBox → Zod schema with extended exec fields:
```typescript
const execSchema = z.object({
  command: z.string().describe("Shell command to execute"),
  workdir: z.string().optional().describe("Working directory (defaults to cwd)"),
  timeout: z.number().optional().describe("Timeout in seconds"),
  background: z.boolean().optional().describe("Run in background immediately"),
  yieldMs: z.number().optional().describe("Ms to wait before backgrounding (default 10000)"),
});
```
4. Replace AgentTool → OpenClawTool
5. Keep: `BashOperations` interface (renamed to `ExecOperations`), `createLocalBashOperations` (renamed to `createLocalExecOperations`), streaming output buffer, temp file spill for large output, tail truncation
6. Add background/yield support: if `background` is true or command exceeds `yieldMs`, register in process registry and return "running" with sessionId

- [ ] **Step 2: Create process-registry.ts**

Create `src/tools/exec/process-registry.ts` — simplified version of openclaw's `bash-process-registry.ts`:

```typescript
import type { ChildProcess } from "node:child_process";

export interface ProcessSession {
  id: string;
  command: string;
  pid: number | undefined;
  startedAt: number;
  cwd: string;
  stdin: NodeJS.WritableStream | null;
  aggregated: string;
  tail: string;
  pendingOutput: string;
  backgrounded: boolean;
  exitCode: number | null;
  exitSignal: string | null;
  exitedAt: number | null;
  child: ChildProcess;
}

const runningSessions = new Map<string, ProcessSession>();
const finishedSessions = new Map<string, ProcessSession>();

export function addSession(session: ProcessSession): void { ... }
export function getSession(id: string): ProcessSession | undefined { ... }
export function getFinishedSession(id: string): ProcessSession | undefined { ... }
export function appendOutput(id: string, chunk: string): void { ... }
export function drainPending(id: string): string { ... }
export function markBackgrounded(id: string): void { ... }
export function markExited(id: string, code: number | null, signal: string | null): void { ... }
export function deleteSession(id: string): void { ... }
export function listSessions(): ProcessSession[] { ... }
```

Keep it ~200 lines. No scope keys, no sweeper, no supervisor — the simplified SDK version.

- [ ] **Step 3: Create process.ts**

Create `src/tools/exec/process.ts` — simplified version of openclaw's process tool:

```typescript
import { z } from "zod";
import type { OpenClawTool, OpenClawToolResult } from "../tool-interface.js";
import { textResult, jsonResult } from "../shared/tool-result.js";
import { getSession, getFinishedSession, drainPending, listSessions, deleteSession } from "./process-registry.js";

const processSchema = z.object({
  action: z.string().describe("Action: list, poll, log, write, kill, remove"),
  sessionId: z.string().optional().describe("Session id (required except for list)"),
  data: z.string().optional().describe("Data to write to stdin"),
  offset: z.number().optional().describe("Log offset"),
  limit: z.number().optional().describe("Log length"),
  timeout: z.number().optional().describe("Poll wait timeout in ms (max 120000)"),
});

export function createProcessTool(): OpenClawTool {
  return {
    name: "process",
    description: "Manage running exec sessions: list, poll, log, write, kill, remove.",
    parameters: processSchema,
    async execute(callId, params) { ... },
  };
}
```

Support actions: `list`, `poll`, `log`, `write`, `kill`, `remove`. Skip: `send-keys`, `submit`, `paste` (PTY-specific, not needed in SDK v1).

- [ ] **Step 4: Write exec test**

Create `tests/unit/tools/exec.test.ts`:

```typescript
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
    expect(text).toMatch(/timeout|killed|signal/i);
  });
});
```

- [ ] **Step 5: Run tests**

```bash
pnpm vitest run tests/unit/tools/exec.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit C13 — process registry**

```bash
git add src/tools/exec/process-registry.ts
git commit -m "$(cat <<'EOF'
feat: add process registry for backgrounded exec sessions

Simplified from openclaw bash-process-registry. In-memory session
tracking with add/get/drain/markExited/delete operations.
No scope keys, no sweeper, no supervisor.

Source: openclaw @ edb5123f (MIT)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Verification C13:**
```bash
pnpm run check  # must pass
```

- [ ] **Step 7: Commit C14 — exec tool**

```bash
git add src/tools/exec/exec.ts tests/unit/tools/exec.test.ts
git commit -m "$(cat <<'EOF'
feat: vendor exec tool (renamed from pi-mono bash)

TypeBox→Zod, stripped TUI, renamed bash→exec. Added background/yield
support from openclaw. Preserved: ExecOperations interface, streaming
output buffer, temp file spill, tail truncation.

Source: pi-mono @ cb4e4d8c + openclaw @ edb5123f (both MIT)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Verification C14:**
```bash
pnpm run check  # must pass
pnpm vitest run tests/unit/tools/exec.test.ts  # must pass
```

- [ ] **Step 8: Commit C15 — process tool (🟢 SAFE ROLLBACK POINT)**

```bash
git add src/tools/exec/process.ts
git commit -m "$(cat <<'EOF'
feat: vendor process tool for backgrounded session management

Actions: list, poll, log, write, kill, remove.
Shares process registry with exec tool.

Source: openclaw @ edb5123f (MIT)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
git tag vendor/exec-tools
```

**Verification C15:**
```bash
pnpm run check && pnpm run build && pnpm vitest run  # ALL must pass
# Schema alignment:
pnpm vitest run tests/unit/tools/schema-alignment.test.ts  # must pass
```

- [ ] **Step 9: Push C13-C15 + tag**

```bash
git push && git push origin --tags
```

---

## Task 7: Vendor Web Tools + SSRF Guard

**Files:**
- Create: `src/tools/web/ssrf.ts`
- Create: `src/tools/web/fetch-guard.ts`
- Create: `src/tools/web/web-fetch.ts`
- Create: `src/tools/web/web-fetch-utils.ts`
- Create: `src/tools/web/web-search.ts`

- [ ] **Step 1: Copy and adapt SSRF guard from openclaw**

Copy `/Users/apple/programme/funny_projects/openclaw/src/infra/net/ssrf.ts` to `src/tools/web/ssrf.ts`.

Adaptations:
1. Replace `../../shared/net/ip.js` import — inline the IP parsing functions (~50 lines)
2. Replace `./hostname.js` import — inline `normalizeHostname` (7 lines)
3. Replace `./undici-runtime.js` import — use `import { Agent } from "undici"` directly
4. Replace `../../logger.js` — use `console.warn` or SDK logger
5. Keep all security logic intact: `isPrivateIpAddress`, `isBlockedHostname`, `resolvePinnedHostnameWithPolicy`, `createPinnedDispatcher`

- [ ] **Step 2: Copy and adapt fetch-guard.ts**

Copy openclaw's `fetch-guard.ts`. Adapt imports to local `ssrf.js`.

- [ ] **Step 3: Copy and adapt web-fetch.ts**

Copy openclaw's `web-fetch.ts`. Major adaptations:
1. Replace `../../config/config.js` — use env vars (`FIRECRAWL_API_KEY`, `FIRECRAWL_BASE_URL`) or SDK options
2. Replace `../../secrets/runtime-web-tools.js` — remove (no runtime secrets in SDK)
3. Replace `../../security/external-content.js` — inline `wrapWebContent` (wraps content with `<web-content>` XML tags)
4. Replace `./web-guarded-fetch.js` — use local `fetch-guard.ts`
5. Replace `./web-shared.js` — inline cache and timeout utilities
6. Remove Firecrawl integration (or make it opt-in via env var)
7. Replace TypeBox schema → Zod
8. Replace AgentTool → OpenClawTool

- [ ] **Step 4: Copy and adapt web-fetch-utils.ts**

Copy openclaw's `web-fetch-utils.ts`. Adapt:
1. Lazy-load `@mozilla/readability` and `linkedom` — these become optional peer deps or use basic HTML→text fallback
2. Keep `htmlToMarkdown` (regex-based, no deps)
3. Keep `truncateText`

- [ ] **Step 5: Create web-search.ts**

Create a simplified single-provider web search tool:

```typescript
import { z } from "zod";
import type { OpenClawTool } from "../tool-interface.js";
import { textResult, failedTextResult } from "../shared/tool-result.js";

const webSearchSchema = z.object({
  query: z.string().describe("Search query"),
  count: z.number().optional().describe("Number of results (default 5, max 10)"),
});

export function createWebSearchTool(): OpenClawTool | null {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return null;

  return {
    name: "web_search",
    description: "Search the web for information.",
    parameters: webSearchSchema,
    async execute(callId, params) {
      const { query, count = 5 } = params as { query: string; count?: number };
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(count, 10)}`;
      const res = await fetch(url, {
        headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
      });
      if (!res.ok) return failedTextResult(`Search failed: ${res.status}`);
      const data = await res.json();
      const results = (data.web?.results ?? []).map((r: any) =>
        `**${r.title}**\n${r.url}\n${r.description ?? ""}`
      ).join("\n\n");
      return textResult(results || "No results found.");
    },
  };
}
```

- [ ] **Step 6: Run typecheck and fix errors**

```bash
pnpm run check
```

- [ ] **Step 7: Commit C16 — SSRF guard**

```bash
git add src/tools/web/ssrf.ts src/tools/web/fetch-guard.ts
git commit -m "$(cat <<'EOF'
feat: vendor SSRF guard from openclaw

DNS rebinding protection, private IP rejection (RFC 1918, loopback,
link-local, IPv4-in-IPv6), hostname blocking (localhost, *.local,
*.internal, metadata.google.internal). Fail-closed on parse errors.

Source: openclaw @ edb5123f (MIT)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Verification C16:**
```bash
pnpm run check  # must pass
pnpm vitest run tests/unit/tools/ssrf.test.ts  # SSRF tests MUST pass — security critical
```

- [ ] **Step 8: Commit C17 — web_fetch tool**

```bash
git add src/tools/web/web-fetch.ts src/tools/web/web-fetch-utils.ts
git commit -m "$(cat <<'EOF'
feat: vendor web_fetch tool from openclaw

SSRF-guarded HTTP fetch with HTML→markdown extraction.
Removed config chain, secrets, Firecrawl (opt-in via env var).

Source: openclaw @ edb5123f (MIT)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Verification C17:**
```bash
pnpm run check  # must pass
grep -rE "\.\./\.\./config/|\.\./\.\./secrets/" src/tools/web/ | wc -l  # must be 0
```

- [ ] **Step 9: Commit C18 — web_search tool (🟢 SAFE ROLLBACK POINT)**

```bash
git add src/tools/web/web-search.ts
git commit -m "$(cat <<'EOF'
feat: add web_search tool (Brave Search API)

Single-provider search. Returns null if BRAVE_SEARCH_API_KEY not set.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
git tag vendor/web-tools
```

**Verification C18:**
```bash
pnpm run check && pnpm run build && pnpm vitest run  # ALL must pass
# SSRF security tests must still pass:
pnpm vitest run tests/unit/tools/ssrf.test.ts  # must pass
```

- [ ] **Step 10: Push C16-C18 + tag**

```bash
git push && git push origin --tags
```

---

## Task 8: Vendor Browser Tool (Host Mode Only)

**Files:**
- Create: `src/tools/browser/browser.ts`
- Create: `src/tools/browser/browser-schema.ts`
- Create: `src/tools/browser/browser-actions.ts`

- [ ] **Step 1: Copy and adapt browser-schema.ts**

Copy openclaw's `browser-tool.schema.ts` to `src/tools/browser/browser-schema.ts`.
Replace TypeBox → Zod. Keep all 16 actions and 11 act kinds. This is a flat schema (not union) for LLM compatibility.

- [ ] **Step 2: Copy and adapt browser-actions.ts**

Copy openclaw's `browser-tool.actions.ts`. Adapt:
1. Remove gateway/node proxy code (`callBrowserProxy`)
2. Remove `wrapExternalContent` — inline or simplify
3. Keep: `executeTabsAction`, `executeSnapshotAction`, `executeConsoleAction`, `executeActAction`
4. These call Playwright directly — document that `playwright` is an optional peer dependency

- [ ] **Step 3: Copy and adapt browser.ts**

Copy openclaw's `browser-tool.ts`. Major adaptations:
1. Remove sandbox target (Docker)
2. Remove node target (remote gateway)
3. Keep only host target (local Playwright)
4. Remove gateway dependency (`callGatewayTool`)
5. Remove node resolution (`resolveNodeId`, `listNodes`)
6. Replace TypeBox → Zod
7. Replace AgentTool → OpenClawTool

- [ ] **Step 4: Run typecheck**

```bash
pnpm run check
```

- [ ] **Step 5: Commit C19 — browser schema**

```bash
git add src/tools/browser/browser-schema.ts
git commit -m "$(cat <<'EOF'
feat: vendor browser tool schema from openclaw

Flat object schema (not union) for LLM compatibility.
16 actions, 11 act kinds. TypeBox→Zod.

Source: openclaw @ edb5123f (MIT)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Verification C19:**
```bash
pnpm run check  # must pass
```

- [ ] **Step 6: Commit C20 — browser tool (🟢 SAFE ROLLBACK POINT)**

```bash
git add src/tools/browser/browser.ts src/tools/browser/browser-actions.ts
git commit -m "$(cat <<'EOF'
feat: vendor browser tool (host mode only) from openclaw

Playwright-based browser automation. Removed sandbox/node modes
and gateway dependency. Host-only execution.

Source: openclaw @ edb5123f (MIT)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
git tag vendor/browser-tool
```

**Verification C20:**
```bash
pnpm run check && pnpm run build && pnpm vitest run  # ALL must pass
grep -rE "callGatewayTool|resolveNodeId|sandboxBridgeUrl" src/tools/browser/ | wc -l  # must be 0
```

- [ ] **Step 7: Push C19-C20 + tag**

```bash
git push && git push origin --tags
```

---

## Task 9: Wire Agentic Loop Into Session

**Files:**
- Create: `src/tools/tool-assembly.ts`
- Modify: `src/core/embedded-runner/sdk-session.ts`
- Modify: `src/core/embedded-runner/sdk-factory.ts`
- Modify: `src/public/sdk.ts`
- Modify: `src/public/types.ts`

This is the critical task — replacing the stub echo with the real Anthropic-powered agentic loop.

- [ ] **Step 1: Add anthropicApiKey to SDK options**

In `src/public/types.ts`, add to `OpenClawSessionParams`:
```typescript
anthropicApiKey?: string;
```

In `src/public/sdk.ts`, add to `OpenClawAgentSdkOptions`:
```typescript
anthropicApiKey?: string;
```

- [ ] **Step 2: Create tool assembly**

Create `src/tools/tool-assembly.ts`:

```typescript
import type { OpenClawTool } from "./tool-interface.js";
import { createReadTool } from "./file/read.js";
import { createWriteTool } from "./file/write.js";
import { createEditTool } from "./file/edit.js";
import { createExecTool } from "./exec/exec.js";
import { createProcessTool } from "./exec/process.js";
import { createWebFetchTool } from "./web/web-fetch.js";
import { createWebSearchTool } from "./web/web-search.js";
// import { createBrowserTool } from "./browser/browser.js";

export function assembleLocalTools(workspaceDir: string): OpenClawTool[] {
  const tools: OpenClawTool[] = [
    createReadTool(workspaceDir),
    createWriteTool(workspaceDir),
    createEditTool(workspaceDir),
    createExecTool(workspaceDir),
    createProcessTool(),
  ];

  const webFetch = createWebFetchTool();
  if (webFetch) tools.push(webFetch);

  const webSearch = createWebSearchTool();
  if (webSearch) tools.push(webSearch);

  // Browser requires Playwright — add when available
  // const browser = createBrowserTool();
  // if (browser) tools.push(browser);

  return tools;
}
```

- [ ] **Step 3: Commit C21 — tool assembly**

```bash
git add src/tools/tool-assembly.ts src/public/types.ts src/public/sdk.ts
git commit -m "$(cat <<'EOF'
feat: add tool assembly and anthropicApiKey option

assembleLocalTools() creates all local SDK tools.
Added anthropicApiKey to OpenClawAgentSdkOptions and
OpenClawSessionParams.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Verification C21:**
```bash
pnpm run check  # must pass
```

- [ ] **Step 4: Replace stub in sdk-session.ts**

This is the main change. In `sdk-session.ts`, replace the `streamTurn()` method's stub logic:

**Before (lines 116-156):**
```typescript
const hostedTool = this.resolveHostedTool(input);
// ... keyword matching ...
const reply = text ? `Acknowledged: ${text}` : "Acknowledged.";
```

**After:** Import Anthropic SDK and the agent loop. In `streamTurn()`:

1. Build Anthropic messages from the turn input
2. Create Anthropic client with `anthropicApiKey` from options
3. Convert local tools + hosted tool definitions to Anthropic tool format
4. Call the Anthropic Messages API via streaming
5. For each streamed event, yield the appropriate `OpenClawStreamEvent`
6. When `stop_reason === "tool_use"`:
   - For local tools: execute them, append results, loop back
   - For hosted tools: yield `hosted_tool_call` event and suspend (existing protocol)
7. When `stop_reason !== "tool_use"`: yield `turn_complete` and return
8. Update `usageSnapshot` with real token counts from the API response

The full implementation follows the pattern established in the plan's agentic loop research. The key is preserving the existing hosted-tool suspend/resume protocol while adding real LLM execution.

- [ ] **Step 5: Update sdk-factory.ts**

Pass `anthropicApiKey` and local tools into session creation.

- [ ] **Step 6: Commit C22 — wire loop into session (⚠️ CRITICAL)**

```bash
git add src/core/embedded-runner/sdk-session.ts src/core/embedded-runner/sdk-factory.ts
git commit -m "$(cat <<'EOF'
feat: wire anthropic agentic loop into sdk session

BREAKING: replaces stub echo with real Anthropic Messages API streaming.
Session now: calls Claude, streams text/thinking deltas, dispatches
local tool calls (read/write/edit/exec/process/web_fetch/web_search),
suspends for hosted tool calls (existing protocol preserved).

Usage tracking now uses real API token counts instead of char/4 estimate.

WARNING: existing integration tests will fail until C23 updates them.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Verification C22:**
```bash
pnpm run check && pnpm run build  # MUST pass
pnpm vitest run  # EXPECTED TO FAIL (old tests reference "Acknowledged" behavior)
# Document which tests fail and why:
pnpm vitest run 2>&1 | grep -E "FAIL|PASS" | head -20
```

**⚠️ This is a CRITICAL commit.** It breaks old tests intentionally. The next commit (C23) fixes them. If you need to abandon: `git revert C22 C21` restores the stub loop and all tests pass again.

---

## Task 10: Update Tests

**Files:**
- Modify: `tests/integration/standalone-session.test.ts`
- Modify: `tests/integration/plugins-and-tools.test.ts`
- Modify: `tests/integration/persistence-and-logging.test.ts`
- Modify: `tests/contract/public-api.test.ts`

- [ ] **Step 1: Create Anthropic mock helper**

Create `tests/helpers/mock-anthropic.ts` with the mock implementation from Section B.3 of the Verification Standards.

- [ ] **Step 2: Update standalone-session test**

The current test sends "finish now" and expects keyword matching. Update to:
- Mock the Anthropic client using the helper from Step 1
- Test hosted-tool protocol via mock (mock returns tool_use → verify hosted_tool_call event)
- Conditional real API tests with `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`

WHY this test changes: the stub echo `"Acknowledged: ..."` no longer exists. The test must now verify the real protocol (Anthropic mock returns tool_use → SDK emits hosted_tool_call → submitHostedToolResult resumes).

- [ ] **Step 3: Update plugins-and-tools test**

WHY: tool policy testing must use tool assembly instead of keyword matching. Verify `isToolAllowedInEmbeddedMode` still blocks `"gateway"`, `"message"`, `"sessions_*"`.

- [ ] **Step 4: Update persistence test**

WHY: transcript JSONL entries now include real API response data instead of "Acknowledged: ...". Verify transcript structure is preserved (type fields, timestamps).

- [ ] **Step 5: Update public-api contract test**

WHY: `anthropicApiKey` added to SDK options type.

- [ ] **Step 6: Run full test suite**

```bash
pnpm vitest run
```

Expected: ALL tests PASS (including the 8 existing + new unit tests).

- [ ] **Step 7: Commit C23 — update tests (🟢 SAFE ROLLBACK POINT)**

```bash
git add tests/
git commit -m "$(cat <<'EOF'
test: update tests for vendored tools and real agentic loop

Update integration tests with Anthropic mock (CI-safe, no API key needed).
Verify tool policy, hosted-tool protocol, transcript persistence,
event normalization still work correctly.

Tests changed:
- standalone-session: mock Anthropic, test real protocol flow
- plugins-and-tools: use tool assembly, verify policy blocking
- persistence-and-logging: verify transcript structure with real data
- public-api: add anthropicApiKey to contract

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
git tag vendor/tests-updated
```

**Verification C23:**
```bash
pnpm run check && pnpm run build && pnpm vitest run  # ALL must pass — this is the recovery point after C22
# Regression check — count test results:
pnpm vitest run 2>&1 | grep -E "Tests.*passed"  # must show 0 failed
```

- [ ] **Step 8: Push C21-C23 + tag**

```bash
git push && git push origin --tags
```

---

## Task 11: Final — Provenance, CI, Smoke Test

**Files:**
- Modify: `manifests/pi-mono-provenance.json`
- Modify: `manifests/upstream-provenance.json`
- Modify: `scripts/package-smoke.mjs`
- Modify: `.github/workflows/sdk-ci.yml`

- [ ] **Step 1: Finalize pi-mono provenance manifest**

Update `manifests/pi-mono-provenance.json` entries with actual adaptation notes for each file (replace "pending" placeholders with real descriptions like "TypeBox→Zod, stripped TUI rendering").

- [ ] **Step 2: Update upstream-provenance.json**

Add entries for files vendored from openclaw (web tools, SSRF, browser, exec/process).

- [ ] **Step 3: Update package smoke test**

Update `scripts/package-smoke.mjs` to test:
- Tool assembly returns tools with correct names
- Anthropic provider types are importable
- Tool interface types are importable

- [ ] **Step 4: Update CI workflow**

Add `ANTHROPIC_API_KEY` as an optional secret. Tests should skip real API calls if the key is not present.

- [ ] **Step 5: Run full CI locally**

```bash
pnpm run check && pnpm run build && pnpm run test && node scripts/package-smoke.mjs
```

Expected: all PASS.

- [ ] **Step 6: Commit C24 — final (🟢 FINAL — PR-ready)**

```bash
git add manifests/ scripts/ .github/
git commit -m "$(cat <<'EOF'
chore: finalize provenance manifests and CI

Update provenance for all vendored files from pi-mono @ cb4e4d8c
and openclaw @ edb5123f. Both MIT licensed.
Update smoke test and CI workflow.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
git tag vendor/complete
```

**Verification C24 (FINAL — all gates must pass):**
```bash
# D.1 Automated gates:
pnpm run check && pnpm run build && pnpm vitest run && node scripts/package-smoke.mjs

# D.2 Import cleanliness:
test $(grep -r "@mariozechner" src/tools/ src/loop/ src/providers/ | wc -l) -eq 0 && echo "PASS" || echo "FAIL"
test $(grep -r "@sinclair/typebox" src/ | wc -l) -eq 0 && echo "PASS" || echo "FAIL"
test $(grep -r "pi-tui" src/ | wc -l) -eq 0 && echo "PASS" || echo "FAIL"

# D.3 Schema verification:
pnpm vitest run tests/unit/tools/schema-alignment.test.ts

# D.4 Security verification:
pnpm vitest run tests/unit/tools/ssrf.test.ts

# D.5 Regression — all 8 original tests pass:
pnpm vitest run tests/contract/ tests/integration/

# D.7 Provenance:
node scripts/verify-upstream-snapshot.mjs
```

- [ ] **Step 7: Push C24 + tag and create PR**

```bash
git push && git push origin --tags
```

Create PR:
```bash
gh pr create --title "refactor: vendor upstream tools and anthropic provider, replace stub loop" --body "$(cat <<'EOF'
## Summary

- Vendor file tools (read, write, edit) from pi-mono with Zod schemas, fuzzy edit matching, and pluggable Operations interfaces
- Vendor exec tool (renamed from pi-mono bash) with background/yield and process management
- Vendor Anthropic streaming provider with extended thinking support (adaptive for Opus 4.6/Sonnet 4.6)
- Vendor agent loop with parallel tool dispatch and abort signal propagation
- Vendor web tools with SSRF protection (DNS rebinding guard, private IP rejection)
- Vendor browser tool (host-mode Playwright, 16 actions)
- Replace PR3 stub echo loop with real Anthropic Messages API streaming
- Real token usage tracking from API (replaces chars/4 estimate)
- Gateway-coupled tools remain as hosted-tool protocol (unchanged)
- All vendored code is MIT licensed

## Source Provenance

| Source | SHA | License | Files |
|--------|-----|---------|-------|
| [badlogic/pi-mono](https://github.com/badlogic/pi-mono) | `cb4e4d8c` | MIT | tools, agent loop, anthropic provider |
| [openclaw/openclaw](https://github.com/openclaw/openclaw) | `edb5123f` | MIT | web tools, SSRF, browser, exec extensions |

## New Dependencies

| Package | Version | License | Purpose |
|---------|---------|---------|---------|
| `@anthropic-ai/sdk` | ^0.80.0 | MIT | Anthropic Messages API client |
| `diff` | ^7.0.0 | BSD-3 | Unified diff for edit tool |
| `partial-json` | ^0.1.7 | MIT | Streaming JSON parse for tool call args |

## Test Plan

- [ ] `pnpm run check` — typecheck passes
- [ ] `pnpm run build` — build succeeds
- [ ] `pnpm vitest run` — all unit + integration tests pass
- [ ] `node scripts/package-smoke.mjs` — packaged smoke test passes
- [ ] Manual: set `ANTHROPIC_API_KEY` and run a session that uses read/write/edit/exec tools

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

---

## Verification & Testing Standards

This section defines the mandatory verification criteria. Every task MUST satisfy its applicable checks before committing. The PR MUST NOT be merged until all gate conditions pass.

### A. Vendor File Verification Checklist

For **every** file copied from pi-mono or openclaw, the implementing agent MUST verify each item before committing. Use this table as a per-file sign-off.

#### A.1 Import Verification

| Check | How to verify | Failure action |
|-------|--------------|----------------|
| No `@mariozechner/pi-*` imports remain | `grep -r "@mariozechner" src/tools/ src/loop/ src/providers/` must return empty | Replace with local relative imports |
| No `@sinclair/typebox` imports remain | `grep -r "@sinclair/typebox" src/tools/ src/loop/ src/providers/` must return empty | Replace with `zod` or `any` |
| No `@mariozechner/pi-tui` imports remain | `grep -r "pi-tui" src/` must return empty | Delete import and all TUI rendering code |
| No openclaw infra imports remain | `grep -rE "\.\./\.\./config/|\.\./\.\./infra/|\.\./\.\./plugins/|\.\./\.\./secrets/|\.\./\.\./security/|\.\./\.\./routing/" src/tools/` must return empty | Replace with SDK-local alternatives or env vars |
| No dead imports | `pnpm run check` passes with `noUnusedLocals: true` | Remove unused import |

Run after every task:
```bash
grep -r "@mariozechner" src/tools/ src/loop/ src/providers/ && echo "FAIL: pi-mono imports remain" || echo "PASS"
grep -r "@sinclair/typebox" src/ && echo "FAIL: typebox imports remain" || echo "PASS"
grep -r "pi-tui" src/ && echo "FAIL: TUI imports remain" || echo "PASS"
```

#### A.2 Schema Alignment Verification

For each vendored tool, the Zod schema MUST match the upstream TypeBox schema field-for-field. Use this checklist:

**read tool:**
| Field | TypeBox upstream | Zod SDK | Match? |
|-------|-----------------|---------|--------|
| `path` | `Type.String()` required | `z.string()` required | Must match |
| `offset` | `Type.Optional(Type.Number())` | `z.number().optional()` | Must match |
| `limit` | `Type.Optional(Type.Number())` | `z.number().optional()` | Must match |

**write tool:**
| Field | TypeBox upstream | Zod SDK | Match? |
|-------|-----------------|---------|--------|
| `path` | `Type.String()` required | `z.string()` required | Must match |
| `content` | `Type.String()` required | `z.string()` required | Must match |

**edit tool:**
| Field | TypeBox upstream | Zod SDK | Match? |
|-------|-----------------|---------|--------|
| `path` | `Type.String()` required | `z.string()` required | Must match |
| `oldText` | `Type.String()` required | `z.string()` required | Must match |
| `newText` | `Type.String()` required | `z.string()` required | Must match |

**exec tool (bash renamed):**
| Field | TypeBox upstream (bash) | Zod SDK (exec) | Match? |
|-------|------------------------|----------------|--------|
| `command` | `Type.String()` required | `z.string()` required | Must match |
| `timeout` | `Type.Optional(Type.Number())` | `z.number().optional()` | Must match |
| `workdir` | N/A (added from openclaw exec) | `z.string().optional()` | SDK extension |
| `background` | N/A (added from openclaw exec) | `z.boolean().optional()` | SDK extension |
| `yieldMs` | N/A (added from openclaw exec) | `z.number().optional()` | SDK extension |

**process tool:**
| Field | TypeBox upstream | Zod SDK | Match? |
|-------|-----------------|---------|--------|
| `action` | `Type.String()` required | `z.string()` required | Must match |
| `sessionId` | `Type.Optional(Type.String())` | `z.string().optional()` | Must match |
| `data` | `Type.Optional(Type.String())` | `z.string().optional()` | Must match |
| `offset` | `Type.Optional(Type.Number())` | `z.number().optional()` | Must match |
| `limit` | `Type.Optional(Type.Number())` | `z.number().optional()` | Must match |
| `timeout` | `Type.Optional(Type.Number())` | `z.number().optional()` | Must match |

**web_fetch tool:**
| Field | TypeBox upstream | Zod SDK | Match? |
|-------|-----------------|---------|--------|
| `url` | `Type.String()` required | `z.string()` required | Must match |
| `extractMode` | `Type.Optional(stringEnum)` | `z.enum([...]).optional()` | Must match |
| `maxChars` | `Type.Optional(Type.Number())` | `z.number().optional()` | Must match |

**web_search tool:**
| Field | TypeBox upstream | Zod SDK | Match? |
|-------|-----------------|---------|--------|
| `query` | `Type.String()` required | `z.string()` required | Must match |
| `count` | `Type.Optional(Type.Number())` | `z.number().optional()` | Must match |

**Automated schema verification test** (create `tests/unit/tools/schema-alignment.test.ts`):

```typescript
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createReadTool } from "../../src/tools/file/read.js";
import { createWriteTool } from "../../src/tools/file/write.js";
import { createEditTool } from "../../src/tools/file/edit.js";
import { createExecTool } from "../../src/tools/exec/exec.js";
import { createProcessTool } from "../../src/tools/exec/process.js";

describe("schema alignment with upstream", () => {
  it("read schema matches upstream fields", () => {
    const tool = createReadTool("/tmp");
    const schema = z.toJSONSchema(tool.parameters) as any;
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["path"]);
    expect(schema.properties.path.type).toBe("string");
    expect(schema.properties.offset.type).toBe("number");
    expect(schema.properties.limit.type).toBe("number");
    // Must NOT have extra fields
    expect(Object.keys(schema.properties).sort()).toEqual(["limit", "offset", "path"]);
  });

  it("write schema matches upstream fields", () => {
    const tool = createWriteTool("/tmp");
    const schema = z.toJSONSchema(tool.parameters) as any;
    expect(schema.required?.sort()).toEqual(["content", "path"]);
    expect(Object.keys(schema.properties).sort()).toEqual(["content", "path"]);
  });

  it("edit schema matches upstream fields", () => {
    const tool = createEditTool("/tmp");
    const schema = z.toJSONSchema(tool.parameters) as any;
    expect(schema.required?.sort()).toEqual(["newText", "oldText", "path"]);
    expect(Object.keys(schema.properties).sort()).toEqual(["newText", "oldText", "path"]);
  });

  it("exec schema has bash fields + extensions", () => {
    const tool = createExecTool("/tmp");
    const schema = z.toJSONSchema(tool.parameters) as any;
    expect(schema.required).toEqual(["command"]);
    expect(schema.properties.command.type).toBe("string");
    expect(schema.properties.timeout.type).toBe("number");
    // SDK extensions beyond upstream bash
    expect(schema.properties.workdir.type).toBe("string");
    expect(schema.properties.background.type).toBe("boolean");
    expect(schema.properties.yieldMs.type).toBe("number");
  });

  it("process schema matches upstream fields", () => {
    const tool = createProcessTool();
    const schema = z.toJSONSchema(tool.parameters) as any;
    expect(schema.required).toEqual(["action"]);
    expect(schema.properties.action.type).toBe("string");
    expect(schema.properties.sessionId.type).toBe("string");
  });

  it("all tools have name matching upstream registry", () => {
    const expectedNames = ["read", "write", "edit", "exec", "process"];
    const tools = [
      createReadTool("/tmp"),
      createWriteTool("/tmp"),
      createEditTool("/tmp"),
      createExecTool("/tmp"),
      createProcessTool(),
    ];
    expect(tools.map(t => t.name)).toEqual(expectedNames);
  });
});
```

#### A.3 Functional Parity Verification

For each vendored tool, verify that the core behavior matches upstream:

| Tool | Upstream behavior | SDK must also do | Verify with |
|------|------------------|------------------|-------------|
| read | Truncates at 2000 lines / 50KB | Same truncation | Test: read a 5000-line file, check output ≤ 2000 lines |
| read | Detects image MIME (jpg/png/gif/webp) | Same detection | Test: read a .png, check `type: "image"` in result |
| read | Supports offset/limit paging | Same paging | Test: read lines 10-20 of a 100-line file |
| write | Creates parent directories | Same mkdir -p | Test: write to `a/b/c/file.txt` where `a/` doesn't exist |
| write | Serializes concurrent writes to same file | Same queue | Test: 10 concurrent writes to same file, all succeed |
| edit | Fuzzy matching (Unicode, smart quotes, trailing whitespace) | Same fuzzy | Test: edit with curly quotes when file has straight quotes |
| edit | Rejects 0 or >1 matches | Same rejection | Test: edit non-existent text → error; edit duplicated text → error |
| edit | Produces unified diff output | Same format | Test: verify diff contains `+`/`-` lines with line numbers |
| exec | Streaming output with tail truncation | Same truncation | Test: run `seq 5000`, check output ≤ 2000 lines |
| exec | Timeout kills process | Same behavior | Test: `sleep 10` with timeout=1 → killed |
| exec | Background/yield returns sessionId | Must work | Test: long command with background=true → returns sessionId |
| process | list shows backgrounded sessions | Must work | Test: exec background, then process list → shows it |
| process | poll drains new output | Must work | Test: exec background `for i in ...`, poll → gets output |
| process | kill terminates session | Must work | Test: exec background `sleep 60`, kill → terminated |

### B. Test Layering Strategy

#### B.1 Unit Tests (`tests/unit/`) — Run without network, no API keys needed

| Layer | What it tests | When it runs | Must pass for commit? |
|-------|--------------|-------------|----------------------|
| `tools/schema-alignment.test.ts` | Zod schemas match upstream TypeBox field-for-field | Every commit | YES |
| `tools/tool-interface.test.ts` | `OpenClawTool` → Anthropic conversion, result helpers | Task 2 commit | YES |
| `tools/read.test.ts` | read tool: text reading, paging, truncation | Task 5 commit | YES |
| `tools/write.test.ts` | write tool: create, overwrite, auto-mkdir, queue | Task 5 commit | YES |
| `tools/edit.test.ts` | edit tool: exact match, fuzzy match, rejection, diff output | Task 5 commit | YES |
| `tools/exec.test.ts` | exec tool: echo, timeout, background/yield | Task 6 commit | YES |
| `tools/process.test.ts` | process tool: list/poll/kill | Task 6 commit | YES |
| `tools/ssrf.test.ts` | SSRF: blocks localhost, private IPs, DNS rebinding | Task 7 commit | YES |
| `providers/anthropic.test.ts` | EventStream, JSON parse, surrogate sanitize | Task 3 commit | YES |
| `loop/agent-loop.test.ts` | Agent loop type shapes, event types | Task 4 commit | YES |

#### B.2 Integration Tests (`tests/integration/`) — May need mocked Anthropic client

| Test file | What it tests | API key needed? | Mock strategy |
|-----------|--------------|-----------------|---------------|
| `standalone-session.test.ts` | Full session lifecycle: create → streamTurn → events | Mocked by default; real with env var | `vi.mock("@anthropic-ai/sdk")` returns canned responses |
| `plugins-and-tools.test.ts` | Tool policy blocks gateway tools, allows local tools | No | Uses tool assembly directly |
| `persistence-and-logging.test.ts` | Transcript JSONL, raw event log, logger callbacks | No | Mock Anthropic client |
| `visionclaw-compat-session.test.ts` | VisionClaw adapter event normalization | No | Mock SDK session |
| `distribution-and-ci.test.ts` | package.json exports, dist files exist | No | Filesystem checks |

#### B.3 Anthropic Mock Strategy

**Default: all tests run without API key.** The Anthropic client is mocked using Vitest's `vi.mock`:

```typescript
// tests/helpers/mock-anthropic.ts
import { vi } from "vitest";

export function createMockAnthropicClient(responses: Array<{
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: any }>;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}>) {
  let callIndex = 0;
  return {
    messages: {
      stream: vi.fn().mockImplementation(() => {
        const response = responses[callIndex++] ?? responses[responses.length - 1];
        // Return an async iterable that yields events matching Anthropic's SSE format
        return {
          [Symbol.asyncIterator]: async function* () {
            yield { type: "message_start", message: { id: "msg_mock", usage: response.usage } };
            for (const block of response.content) {
              if (block.type === "text") {
                yield { type: "content_block_start", index: 0, content_block: { type: "text" } };
                yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: block.text } };
                yield { type: "content_block_stop", index: 0 };
              }
              if (block.type === "tool_use") {
                yield { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } };
                yield { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } };
                yield { type: "content_block_stop", index: 0 };
              }
            }
            yield { type: "message_delta", delta: { stop_reason: response.stop_reason }, usage: response.usage };
          },
          finalMessage: async () => response,
        };
      }),
    },
  };
}
```

**Conditional real API tests** (run only when `ANTHROPIC_API_KEY` is set):

```typescript
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

(ANTHROPIC_API_KEY ? describe : describe.skip)("real API", () => {
  it("completes a simple turn", async () => { ... });
  it("executes a read tool call", async () => { ... });
});
```

#### B.4 SSRF Security Tests (MANDATORY)

Create `tests/unit/tools/ssrf.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { isPrivateIpAddress, isBlockedHostname } from "../../../src/tools/web/ssrf.js";

describe("SSRF protection", () => {
  describe("isBlockedHostname", () => {
    it("blocks localhost", () => {
      expect(isBlockedHostname("localhost")).toBe(true);
    });
    it("blocks *.localhost", () => {
      expect(isBlockedHostname("evil.localhost")).toBe(true);
    });
    it("blocks *.local", () => {
      expect(isBlockedHostname("router.local")).toBe(true);
    });
    it("blocks *.internal", () => {
      expect(isBlockedHostname("service.internal")).toBe(true);
    });
    it("blocks metadata.google.internal", () => {
      expect(isBlockedHostname("metadata.google.internal")).toBe(true);
    });
    it("allows normal hostnames", () => {
      expect(isBlockedHostname("example.com")).toBe(false);
      expect(isBlockedHostname("api.github.com")).toBe(false);
    });
  });

  describe("isPrivateIpAddress", () => {
    it("blocks 127.0.0.0/8", () => {
      expect(isPrivateIpAddress("127.0.0.1")).toBe(true);
      expect(isPrivateIpAddress("127.255.255.255")).toBe(true);
    });
    it("blocks 10.0.0.0/8", () => {
      expect(isPrivateIpAddress("10.0.0.1")).toBe(true);
      expect(isPrivateIpAddress("10.255.255.255")).toBe(true);
    });
    it("blocks 172.16.0.0/12", () => {
      expect(isPrivateIpAddress("172.16.0.1")).toBe(true);
      expect(isPrivateIpAddress("172.31.255.255")).toBe(true);
    });
    it("blocks 192.168.0.0/16", () => {
      expect(isPrivateIpAddress("192.168.0.1")).toBe(true);
      expect(isPrivateIpAddress("192.168.255.255")).toBe(true);
    });
    it("blocks 169.254.0.0/16 (link-local)", () => {
      expect(isPrivateIpAddress("169.254.169.254")).toBe(true);
    });
    it("blocks ::1 (IPv6 loopback)", () => {
      expect(isPrivateIpAddress("::1")).toBe(true);
    });
    it("blocks IPv4-mapped IPv6", () => {
      expect(isPrivateIpAddress("::ffff:127.0.0.1")).toBe(true);
      expect(isPrivateIpAddress("::ffff:10.0.0.1")).toBe(true);
    });
    it("allows public IPs", () => {
      expect(isPrivateIpAddress("8.8.8.8")).toBe(false);
      expect(isPrivateIpAddress("1.1.1.1")).toBe(false);
      expect(isPrivateIpAddress("142.250.80.46")).toBe(false);
    });
    it("fails closed on invalid input", () => {
      // Security: unparseable input must be treated as blocked
      expect(isPrivateIpAddress("not-an-ip")).toBe(true);
    });
  });
});
```

This test file is **not optional**. SSRF bypass = security vulnerability.

#### B.5 Per-Tool Required Test Cases

Each tool MUST have tests covering at minimum these cases:

**read:**
- [ ] Read existing text file → returns content
- [ ] Read non-existent file → returns error
- [ ] Read with offset/limit → returns correct subset
- [ ] Read file > 2000 lines → truncated, includes truncation notice
- [ ] Read image file (create temp .png with magic bytes) → returns `type: "image"`
- [ ] Read empty file → returns empty text or notice

**write:**
- [ ] Write new file → file created with correct content
- [ ] Write overwrites existing → content replaced
- [ ] Write to nested path `a/b/c/file.txt` → directories created
- [ ] Write empty content → creates empty file

**edit:**
- [ ] Exact text match → replaced, returns diff
- [ ] Fuzzy match (trailing whitespace differs) → replaced
- [ ] Fuzzy match (smart quotes → straight quotes) → replaced
- [ ] Zero matches → returns error "not found"
- [ ] Multiple matches → returns error "ambiguous"
- [ ] New text same as old text → returns error or no-op

**exec:**
- [ ] `echo hello` → output contains "hello"
- [ ] Non-existent command → returns error
- [ ] Timeout exceeded → process killed, returns timeout notice
- [ ] `background: true` → returns immediately with sessionId
- [ ] Exit code non-zero → result indicates failure

**process:**
- [ ] `list` with no sessions → empty list
- [ ] `list` after backgrounded exec → shows session
- [ ] `poll` on running session → returns new output
- [ ] `kill` on running session → terminates
- [ ] `remove` on finished session → removed from registry

**web_fetch:** (requires network — skip in CI unless env flag set)
- [ ] Fetch valid public URL → returns content
- [ ] Fetch `http://localhost:8080` → SSRF blocked
- [ ] Fetch `http://169.254.169.254` → SSRF blocked
- [ ] Fetch non-existent domain → returns error

**web_search:** (requires `BRAVE_SEARCH_API_KEY` — skip if not set)
- [ ] Search valid query → returns results
- [ ] No API key → `createWebSearchTool()` returns null

### C. Regression Matrix

The 8 existing tests must all pass after changes. Here is the impact analysis:

| Existing test | What it currently tests | Impact from this plan | Required changes |
|---------------|------------------------|----------------------|------------------|
| `contract/public-api.test.ts` | `createOpenClawAgentSdk` export exists | `anthropicApiKey` added to options type | Add `anthropicApiKey` to test fixture |
| `contract/upstream-provenance.test.ts` | provenance manifest has 16 entries | New pi-mono manifest added | Add test for `pi-mono-provenance.json` |
| `contract/visionclaw-compat.test.ts` | compat adapter exports exist | No change | None |
| `integration/standalone-session.test.ts` | "finish now" triggers `hosted_tool_call` | Keyword matching replaced with real LLM | Mock Anthropic client; test hosted-tool protocol via mock |
| `integration/plugins-and-tools.test.ts` | "gateway" blocked, "finish" allowed | Tool policy unchanged | Update to use tool assembly for local tool names |
| `integration/persistence-and-logging.test.ts` | transcript JSONL, logger events | Transcript format unchanged but content is real API | Mock Anthropic client; verify transcript structure |
| `integration/distribution-and-ci.test.ts` | package.json exports, dist files | New files added to dist | Add checks for new dist paths |
| `integration/visionclaw-compat-session.test.ts` | event normalization | Event types unchanged | None (may need mock update) |

**Rule: if any existing test must change, the commit message MUST explain WHY.**

### D. PR Merge Gate Conditions

The PR MUST NOT be merged until ALL of the following pass:

#### D.1 Automated Gates (must pass in CI)

- [ ] `pnpm run check` — TypeScript compilation with strict mode, zero errors
- [ ] `pnpm run build` — dist/ output generated successfully
- [ ] `pnpm vitest run` — ALL unit and integration tests pass (zero failures, zero skips except API-key-gated tests)
- [ ] `node scripts/verify-upstream-snapshot.mjs` — upstream provenance manifest valid
- [ ] `node scripts/package-smoke.mjs` — packaged SDK installs and imports cleanly in a fresh project

#### D.2 Import Cleanliness (must pass in CI)

```bash
# Zero results required for each:
grep -r "@mariozechner" src/tools/ src/loop/ src/providers/ | wc -l  # must be 0
grep -r "@sinclair/typebox" src/ | wc -l                              # must be 0
grep -r "pi-tui" src/ | wc -l                                         # must be 0
```

#### D.3 Schema Verification (must pass in CI)

- [ ] `tests/unit/tools/schema-alignment.test.ts` — all tool schemas match upstream field names, types, and required/optional status

#### D.4 Security Verification (must pass in CI)

- [ ] `tests/unit/tools/ssrf.test.ts` — all SSRF blocking tests pass (localhost, private IPs, IPv4-in-IPv6, metadata endpoint, link-local)

#### D.5 Regression Verification (must pass in CI)

- [ ] All 8 existing tests pass (3 contract + 5 integration)
- [ ] If any existing test was modified, the commit explains why

#### D.6 Manual Verification (before merge, one-time)

- [ ] Set `ANTHROPIC_API_KEY` and run: create session → send "read the file package.json and tell me the version" → verify read tool is called, file is read, response references version `0.0.0`
- [ ] Verify `exec` tool: send "run `ls -la` in the current directory" → verify exec tool is called, output returned
- [ ] Verify hosted tool suspend: register a hosted tool "custom_action", send message that triggers it → verify `hosted_tool_call` event emitted with correct callId

#### D.7 Provenance Verification (must pass in CI)

- [ ] `manifests/pi-mono-provenance.json` has entries for every file under `src/tools/`, `src/loop/`, `src/providers/` that was copied from pi-mono
- [ ] `manifests/upstream-provenance.json` has entries for every file under `src/tools/web/`, `src/tools/browser/`, `src/tools/exec/process*` that was copied from openclaw
- [ ] Every manifest entry has a `mode` field (`"adapted"` or `"copied"`) and an `adaptations` array describing what was changed

---

## Appendix: Files NOT Touched (Preserved As-Is)

These files from PR3 are architecturally correct and remain unchanged:

| File | Reason preserved |
|------|-----------------|
| `src/public/events.ts` | 11 event kinds — all needed, none added |
| `src/public/session.ts` | 15 session methods — interface unchanged |
| `src/public/host-tools.ts` | Hosted tool protocol — unchanged |
| `src/public/persistence.ts` | Session store adapter — unchanged |
| `src/index.ts` | Re-exports — unchanged |
| `src/core/tools/tool-policy.ts` | Deny list — unchanged |
| `src/core/normalization/upstream-events.ts` | Event factories — unchanged |
| `src/core/plugins/plugin-runtime.ts` | Plugin init stub — unchanged |
| `src/core/sessions/session-store.ts` | Session file resolver — unchanged |
| `src/core/logging/host-logger.ts` | Logger sink — unchanged |
| `src/compat/visionclaw/*` | All 4 files — unchanged |
| `src/upstream/openclaw/*` | All 16 reference files — unchanged, excluded from build |
