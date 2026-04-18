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

  it("contains Gate model section", () => {
    expect(top).toContain("Gate model:");
  });

  it("contains Management and advanced categories section", () => {
    expect(top).toContain("Management and advanced categories:");
  });

  for (const category of ["setup", "exec", "collect", "import", "report", "analyze", "debug", "policy", "dev"]) {
    it(`lists ${category} category`, () => {
      expect(top).toContain(category);
    });
  }
});

describe("analyze query --help", () => {
  it("includes SQL examples", () => {
    const out = help("analyze query");
    expect(out).toContain("Examples:");
    expect(out).toMatch(/SELECT.*test_results/);
  });
});
