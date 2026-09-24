import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { join } from "node:path";

function help(args: string = ""): string {
  return execSync(`node ${join(process.cwd(), "dist/cli/main.js")} ${args} --help`, { encoding: "utf-8" });
}

describe("flaker --help", () => {
  const top = help();

  it("contains Getting started section", () => {
    expect(top).toContain("Getting started:");
  });

  it("contains Primary commands section", () => {
    expect(top).toContain("Primary commands:");
  });

  it("no longer contains an Advanced section (dev folded into hidden dev in 0.13.0)", () => {
    expect(top).not.toContain("Advanced:");
  });

  it("no longer contains Deprecated section (removed in 0.8.0)", () => {
    expect(top).not.toContain("Deprecated (removed in 0.8.0):");
  });

  // setup, exec, collect, policy categories removed in 0.8.0 — checks dropped.
  // analyze was never a top-level category; dev is hidden in 0.13.0 — both dropped from this loop.
  for (const category of ["import", "report", "debug"]) {
    it(`lists ${category} category`, () => {
      expect(top).toContain(category);
    });
  }
});

// `flaker analyze query` was removed in 0.8.0; help-shape test for it is deleted.
