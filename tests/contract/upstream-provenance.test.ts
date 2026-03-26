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
