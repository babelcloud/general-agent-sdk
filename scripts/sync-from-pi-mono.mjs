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
