import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("flaker query", () => {
  it("`flaker query --help` lists the SQL positional argument", () => {
    const res = spawnSync("node", [CLI, "query", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/sql/i);
  });

  it("`flaker analyze query --help` emits the deprecation warning", () => {
    const res = spawnSync("node", [CLI, "analyze", "query", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("deprecated");
    expect(res.stderr).toContain("flaker query");
  });
});
