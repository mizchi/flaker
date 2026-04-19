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

  // import report / import parquet removed in 0.8.0 — subcommands no longer registered.
  it("removed: `flaker import report <file>` exits non-zero", () => {
    const res = spawnSync("node", [CLI, "import", "report", "/tmp/x.json"], { encoding: "utf8" });
    expect(res.status).not.toBe(0);
  });

  it("removed: `flaker import parquet <dir>` exits non-zero", () => {
    const res = spawnSync("node", [CLI, "import", "parquet", "/tmp/x"], { encoding: "utf8" });
    expect(res.status).not.toBe(0);
  });
});
