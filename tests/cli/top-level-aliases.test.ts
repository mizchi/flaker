import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { join } from "node:path";

describe("top-level aliases", () => {
  const cliPath = join(process.cwd(), "dist/cli/main.js");

  it("flaker init --help shows setup init options", () => {
    const help = execSync(`node ${cliPath} init --help`, { encoding: "utf-8" });
    expect(help).toContain("--owner");
    expect(help).toContain("--adapter");
    expect(help).toContain("--runner");
  });

  it("flaker run --help shows exec run options", () => {
    const help = execSync(`node ${cliPath} run --help`, { encoding: "utf-8" });
    expect(help).toContain("--dry-run");
    expect(help).toContain("--explain");
    expect(help).toContain("--strategy");
    expect(help).toContain("--cluster-mode");
    expect(help).toContain("--skip-flaky-tagged");
  });

  it("flaker kpi --help shows analyze kpi options", () => {
    const help = execSync(`node ${cliPath} kpi --help`, { encoding: "utf-8" });
    expect(help).toContain("--window-days");
    expect(help).toContain("--json");
  });

  it("flaker collect --help shows collect subcommands and ci options", () => {
    const help = execSync(`node ${cliPath} collect --help`, { encoding: "utf-8" });
    expect(help).toContain("--days");
    expect(help).toContain("ci");
    expect(help).toContain("local");
    expect(help).toContain("calibrate");
  });
});
