import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("flaker ops daily removed in 0.10.0", () => {
  it("is no longer a valid subcommand (exit non-zero)", () => {
    const res = spawnSync("node", [CLI, "ops", "daily"], { encoding: "utf8" });
    expect(res.status).not.toBe(0);
  });

  it("flaker ops weekly still works (--help exits 0)", () => {
    const res = spawnSync("node", [CLI, "ops", "weekly", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
  });

  it("flaker ops incident still works (--help exits 0)", () => {
    const res = spawnSync("node", [CLI, "ops", "incident", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
  });
});
