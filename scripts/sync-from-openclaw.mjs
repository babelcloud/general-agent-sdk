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
  throw new Error(
    "usage: node scripts/sync-from-openclaw.mjs --source-root <path> --manifest <path> --file-list <path> [--upstream-sha <sha>]",
  );
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const fileList = JSON.parse(fs.readFileSync(path.resolve(fileListPath), "utf-8"));
const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), "utf-8"));
const nextEntries = [];

for (const upstreamPath of fileList.files) {
  const sourceFile = path.join(sourceRoot, upstreamPath);
  const destFile = path.join(
    repoRoot,
    "src",
    "upstream",
    "openclaw",
    upstreamPath.replace(/^src\//, ""),
  );

  if (!fs.existsSync(sourceFile)) {
    throw new Error(`missing upstream source file: ${sourceFile}`);
  }

  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.copyFileSync(sourceFile, destFile);
  nextEntries.push({
    dest: path.relative(repoRoot, destFile).replaceAll("\\", "/"),
    upstream: upstreamPath,
    upstreamSha,
    mode: "copied",
  });
}

manifest.entries = nextEntries;
fs.writeFileSync(
  path.resolve(manifestPath),
  JSON.stringify(manifest, null, 2) + "\n",
  "utf-8",
);
console.log(`synced ${nextEntries.length} files from ${sourceRoot}`);
