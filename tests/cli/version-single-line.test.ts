import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("flaker --version outputs a single line", () => {
  it("stdout has exactly one non-empty line matching the semver form", () => {
    const res = spawnSync("node", [CLI, "--version"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    const lines = res.stdout.split("\n").filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
    expect(res.stdout).not.toContain("flaker core CLI");
  });

  it("stderr does not contain the moonbit banner", () => {
    const res = spawnSync("node", [CLI, "--version"], { encoding: "utf8" });
    expect(res.stderr).not.toContain("flaker core CLI");
  });
});
