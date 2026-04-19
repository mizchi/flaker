import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("flaker plan", () => {
  it("prints help text mentioning 'Preview actions'", () => {
    const res = spawnSync("node", [CLI, "plan", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Preview actions");
  });
});

describe("flaker apply", () => {
  it("prints help text mentioning 'Apply planned actions'", () => {
    const res = spawnSync("node", [CLI, "apply", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Apply planned actions");
  });
});
