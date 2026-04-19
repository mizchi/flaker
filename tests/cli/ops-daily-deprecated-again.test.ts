import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("ops daily re-deprecated in 0.9.0", () => {
  it("flaker ops daily --help emits deprecation warning pointing at flaker apply --emit daily", () => {
    const res = spawnSync("node", [CLI, "ops", "daily", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);  // --help always exits 0
    expect(res.stderr).toContain("deprecated");
    expect(res.stderr).toContain("flaker apply --emit daily");
  });

  it("flaker ops weekly --help is NOT deprecated", () => {
    const res = spawnSync("node", [CLI, "ops", "weekly", "--help"], { encoding: "utf8" });
    expect(res.stderr).not.toContain("deprecated");
  });

  it("flaker ops incident --help is NOT deprecated", () => {
    const res = spawnSync("node", [CLI, "ops", "incident", "--help"], { encoding: "utf8" });
    expect(res.stderr).not.toContain("deprecated");
  });
});
