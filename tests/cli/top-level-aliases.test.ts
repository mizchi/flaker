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
    expect(help).toContain("--gate");
    expect(help).toContain("--dry-run");
    expect(help).toContain("--explain");
    expect(help).toContain("--strategy");
    expect(help).toContain("--cluster-mode");
    expect(help).toContain("--skip-flaky-tagged");
    expect(help).toContain("iteration");
    expect(help).toContain("merge");
    expect(help).toContain("release");
  });

  it("flaker kpi --help shows analyze kpi options", () => {
    const help = execSync(`node ${cliPath} kpi --help`, { encoding: "utf-8" });
    expect(help).toContain("--window-days");
    expect(help).toContain("--json");
  });

  it("flaker status --help shows user-facing status options", () => {
    const help = execSync(`node ${cliPath} status --help`, { encoding: "utf-8" });
    expect(help).toContain("--window-days");
    expect(help).toContain("--json");
  });

  it("flaker gate review --help shows gate review options", () => {
    const help = execSync(`node ${cliPath} gate review --help`, { encoding: "utf-8" });
    expect(help).toContain("--window-days");
    expect(help).toContain("--json");
  });

  it("flaker gate explain --help shows gate explain options", () => {
    const help = execSync(`node ${cliPath} gate explain --help`, { encoding: "utf-8" });
    expect(help).toContain("--json");
  });

  it("flaker gate history --help shows gate history options", () => {
    const help = execSync(`node ${cliPath} gate history --help`, { encoding: "utf-8" });
    expect(help).toContain("--window-days");
    expect(help).toContain("--json");
  });

  it("flaker quarantine suggest --help shows quarantine suggest options", () => {
    const help = execSync(`node ${cliPath} quarantine suggest --help`, { encoding: "utf-8" });
    expect(help).toContain("--window-days");
    expect(help).toContain("--output");
    expect(help).toContain("--json");
  });

  it("flaker doctor --help shows the top-level doctor alias", () => {
    const help = execSync(`node ${cliPath} doctor --help`, { encoding: "utf-8" });
    expect(help).toContain("User-facing environment check");
  });

  it("flaker collect --help shows collect subcommands and ci options", () => {
    const help = execSync(`node ${cliPath} collect --help`, { encoding: "utf-8" });
    expect(help).toContain("--days");
    expect(help).toContain("ci");
    expect(help).toContain("local");
    expect(help).toContain("calibrate");
  });
});
