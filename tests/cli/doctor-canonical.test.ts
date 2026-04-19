import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("flaker doctor (canonical) is not deprecated", () => {
  it("flaker doctor --help does NOT emit deprecation warning", () => {
    const res = spawnSync("node", [CLI, "doctor", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stderr).not.toContain("deprecated");
  });

  it("flaker debug doctor --help DOES emit deprecation warning pointing at flaker doctor", () => {
    const res = spawnSync("node", [CLI, "debug", "doctor", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("deprecated");
    expect(res.stderr).toContain("flaker doctor");
  });
});
