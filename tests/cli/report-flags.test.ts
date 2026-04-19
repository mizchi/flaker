import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("flaker report flag-based API", () => {
  it("`flaker report --help` lists --summary/--diff/--aggregate", () => {
    const res = spawnSync("node", [CLI, "report", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/--summary/);
    expect(res.stdout).toMatch(/--diff/);
    expect(res.stdout).toMatch(/--aggregate/);
  });

  // report summary/diff/aggregate removed in 0.8.0 — tombstone exits non-zero.
  it("removed subcommands exit non-zero", () => {
    for (const sub of ["summary", "diff", "aggregate"]) {
      const res = spawnSync("node", [CLI, "report", sub], { encoding: "utf8" });
      expect(res.status).not.toBe(0);
    }
  });
});
