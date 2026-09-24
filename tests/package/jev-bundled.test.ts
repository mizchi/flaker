import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const MAIN = resolve(__filename, "../../../dist/cli/main.js");

describe("jev-test-filter is bundled, not a runtime dependency", () => {
  it("dist/cli/main.js does not import jev-test-filter", () => {
    const text = readFileSync(MAIN, "utf8");
    expect(text).not.toMatch(/from\s*["']jev-test-filter/);
    expect(text).not.toMatch(/import\(\s*["']jev-test-filter/);
  });

  it("package.json keeps it out of dependencies", () => {
    const pkg = JSON.parse(readFileSync(resolve(__filename, "../../../package.json"), "utf8"));
    expect(pkg.dependencies?.["jev-test-filter"]).toBeUndefined();
    expect(pkg.devDependencies?.["jev-test-filter"]).toMatch(/^\^0\.1\./);
  });

  // Red until the CLI bundle reaches the jev adapter (phase 2b, Task B6):
  // unskip it there.
  it.skip("the bundle carries jev's gate", () => {
    expect(readFileSync(MAIN, "utf8")).toContain("unsureMargin");
  });
});
