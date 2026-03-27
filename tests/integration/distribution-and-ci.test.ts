import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");

describe("distribution and ci", () => {
  it("declares dist-only packaging and a CI workflow that runs the packaged smoke test", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"),
    ) as {
      files?: string[];
      scripts?: Record<string, string>;
    };

    expect(packageJson.files).toContain("dist/**/*");
    expect(packageJson.files).not.toContain("src/**/*");
    expect(packageJson.files).not.toContain("tests/**/*");
    expect(packageJson.scripts?.prepack).toBe("pnpm run build");
    expect(packageJson.scripts?.["test:e2e"]).toBe("node scripts/package-smoke.mjs");

    const workflow = fs.readFileSync(
      path.join(ROOT, ".github", "workflows", "sdk-ci.yml"),
      "utf-8",
    );
    expect(workflow).toContain("pnpm install --frozen-lockfile");
    expect(workflow).toContain("pnpm run check");
    expect(workflow).toContain("pnpm run build");
    expect(workflow).toContain("pnpm run test");
    expect(workflow).toContain("node scripts/verify-upstream-snapshot.mjs");
    expect(workflow).toContain("pnpm run test:e2e");
  });

  it("keeps the compat/visionclaw entrypoint in the built dist tree", () => {
    const compatEntrypoint = path.join(
      ROOT,
      "dist",
      "compat",
      "visionclaw",
      "index.js",
    );

    expect(fs.existsSync(compatEntrypoint)).toBe(true);
  });
});
