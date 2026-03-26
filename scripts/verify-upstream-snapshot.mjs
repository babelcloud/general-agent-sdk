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
