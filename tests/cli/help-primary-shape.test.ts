/**
 * Tests for the 0.13.0 top-level help shape: `flaker --help` must expose the
 * primary commands in a "Primary" section, with no "Advanced" or
 * "Deprecated" sections (dev is hidden, ops was removed).
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

  it("no longer contains an Advanced section (dev is hidden, ops removed in 0.13.0)", () => {
    expect(stdout).not.toMatch(/Advanced:/i);
  });

  it("no longer contains a Deprecated section header (removed in 0.8.0)", () => {
    // The word "deprecated" may appear in inline notes (e.g. ops daily deprecation notice);
    // what 0.8.0 removed was the standalone "Deprecated:" section heading.
    expect(stdout).not.toMatch(/^Deprecated:/im);
  });

  const primaryNames = [
    "init",
    "plan",
    "apply",
    "status",
    "run",
    "calibrate",
    "doctor",
    "debug",
    "query",
    "export",
    "explain",
    "import",
  ];

  it("lists all 12 primary commands before the closing note", () => {
    // Everything before the closing "Run `flaker" note is the "primary" region
    const primarySection = stdout.split(/Run `flaker/)[0];
    for (const name of primaryNames) {
      expect(primarySection).toContain(name);
    }
  });

  it("lists report command", () => {
    expect(stdout).toContain("report");
  });

  // gate review removed in 0.8.0 — assertion deleted.

  it("no longer mentions ops (removed in 0.13.0)", () => {
    expect(stdout).not.toMatch(/^\s+ops\b/m);
  });
});
