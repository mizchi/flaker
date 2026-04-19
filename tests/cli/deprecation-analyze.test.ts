import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("analyze leaves deprecation warnings", () => {
  for (const [cmd, canonical] of [
    ["kpi", "flaker status"],
    ["eval", "flaker status --markdown"],
    ["flaky", "flaker status --list flaky"],
    ["flaky-tag", "flaker apply"],
  ] as const) {
    it(`\`flaker analyze ${cmd} --help\` emits deprecation warning pointing to ${canonical}`, () => {
      const res = spawnSync("node", [CLI, "analyze", cmd, "--help"], { encoding: "utf8" });
      expect(res.status).toBe(0);
      expect(res.stderr).toContain("deprecated");
      expect(res.stderr).toContain(canonical);
    });
  }
});
