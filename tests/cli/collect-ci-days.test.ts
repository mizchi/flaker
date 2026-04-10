import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { join } from "node:path";

describe("flaker collect ci --days", () => {
  const cliPath = join(process.cwd(), "dist/cli/main.js");

  it("lists --days in help and not --last", () => {
    const help = execSync(`node ${cliPath} collect ci --help`, { encoding: "utf-8" });
    expect(help).toContain("--days");
    expect(help).not.toContain("--last");
  });
});
