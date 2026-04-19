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

  it("deprecated subcommands warn", () => {
    for (const sub of ["summary", "diff", "aggregate"]) {
      const res = spawnSync("node", [CLI, "report", sub, "--help"], { encoding: "utf8" });
      expect(res.status).toBe(0);
      expect(res.stderr).toContain("deprecated");
      expect(res.stderr).toContain(`flaker report`);
    }
  });
});
