import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("flaker import (top-level)", () => {
  it("`flaker import --help` works", () => {
    const res = spawnSync("node", [CLI, "import", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/file/i);
  });

  it("deprecated: `flaker import report --help` warns", () => {
    const res = spawnSync("node", [CLI, "import", "report", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("deprecated");
    expect(res.stderr).toContain("flaker import");
  });

  it("deprecated: `flaker import parquet --help` warns", () => {
    const res = spawnSync("node", [CLI, "import", "parquet", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("deprecated");
    expect(res.stderr).toContain("flaker import");
  });
});
