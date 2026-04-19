/**
 * Tests for Task 11: `flaker --help` must expose 10 primary commands in a
 * "Primary" section, followed by "Advanced" and "Deprecated" sections.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CLI = join(process.cwd(), "dist/cli/main.js");

describe("flaker --help top-level shape (Task 11)", () => {
  const res = spawnSync("node", [CLI, "--help"], { encoding: "utf8" });
  const stdout = res.stdout;

  it("exits cleanly", () => {
    expect(res.status).toBe(0);
  });

  it("contains a Primary commands section", () => {
    expect(stdout).toMatch(/Primary commands?:/i);
  });

  it("contains an Advanced section", () => {
    expect(stdout).toMatch(/Advanced:/i);
  });

  it("contains a Deprecated section", () => {
    expect(stdout).toMatch(/Deprecated/i);
  });

  const primaryNames = [
    "init",
    "plan",
    "apply",
    "status",
    "run",
    "doctor",
    "debug",
    "query",
    "explain",
    "import",
  ];

  it("lists all 10 primary commands before the Advanced section", () => {
    // Everything before "Advanced:" is the "primary" region
    const primarySection = stdout.split(/Advanced:/i)[0];
    for (const name of primaryNames) {
      expect(primarySection).toContain(name);
    }
  });

  it("lists report command", () => {
    expect(stdout).toContain("report");
  });

  it("mentions gate review under Advanced", () => {
    const advancedSection = stdout.split(/Advanced:/i)[1] ?? "";
    expect(advancedSection).toContain("gate");
  });

  it("mentions ops under Advanced", () => {
    const advancedSection = stdout.split(/Advanced:/i)[1] ?? "";
    expect(advancedSection).toContain("ops");
  });
});
