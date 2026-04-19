import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("deprecation warnings", () => {
  it("`flaker kpi --help` emits a deprecation note on stderr", () => {
    const res = spawnSync("node", [CLI, "kpi", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("deprecated");
    expect(res.stderr).toContain("flaker analyze kpi");
  });

  it("`flaker doctor --help` emits a deprecation note on stderr", () => {
    const res = spawnSync("node", [CLI, "doctor", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("deprecated");
    expect(res.stderr).toContain("flaker debug doctor");
  });
});
