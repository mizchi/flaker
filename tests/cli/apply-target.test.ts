import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("flaker apply --target", () => {
  it("--help lists --target", () => {
    const res = spawnSync("node", [CLI, "apply", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("--target");
  });

  it("rejects unknown kind with exit 2", () => {
    const res = spawnSync("node", [CLI, "apply", "--target", "nonsense"], { encoding: "utf8" });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("--target");
  });
});
