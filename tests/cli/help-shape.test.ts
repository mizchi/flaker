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

  it("contains Advanced section", () => {
    expect(top).toContain("Advanced:");
  });

  it("contains Deprecated section", () => {
    expect(top).toContain("Deprecated (removed in 0.8.0):");
  });

  // setup, exec, collect, policy categories removed in 0.8.0 — checks dropped.
  for (const category of ["import", "report", "analyze", "debug", "dev"]) {
    it(`lists ${category} category`, () => {
      expect(top).toContain(category);
    });
  }
});

// `flaker analyze query` was removed in 0.8.0; help-shape test for it is deleted.
