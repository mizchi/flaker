import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("remaining deprecated shims removed in 0.8.0", () => {
  const REMOVED = [
    ["setup", "init"],
    ["setup"],
    ["exec", "run"],
    ["exec", "affected"],
    ["exec"],
    ["debug", "doctor"],
    ["import", "report", "/tmp/x.json"],
    ["import", "parquet", "/tmp/x"],
    ["report", "summary"],
    ["report", "diff"],
    ["report", "aggregate", "/tmp/x"],
    ["kpi"],
  ];

  for (const args of REMOVED) {
    it(`flaker ${args.join(" ")} is no longer a valid command`, () => {
      const res = spawnSync("node", [CLI, ...args], { encoding: "utf8" });
      expect(res.status).not.toBe(0);
    });
  }
});
