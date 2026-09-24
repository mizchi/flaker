import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const MAIN = resolve(__filename, "../../../dist/cli/main.js");

const SRC = resolve(__filename, "../../../src");

function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

describe("jev-test-filter is bundled, not a runtime dependency", () => {
  // The checks below read the build output; a missing or stale bundle would
  // make them pass or fail for the wrong reason.
  it("dist/cli/main.js is built from the current src (run `pnpm build`)", () => {
    expect(existsSync(MAIN), `${MAIN} is missing; run \`pnpm build\``).toBe(true);
    expect(
      statSync(MAIN).mtimeMs >= newestMtime(SRC),
      `${MAIN} is older than src/; run \`pnpm build\``,
    ).toBe(true);
  });

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

  it("the bundle carries jev's gate", () => {
    expect(readFileSync(MAIN, "utf8")).toContain("unsureMargin");
  });
});
