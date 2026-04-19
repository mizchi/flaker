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

  // flaker kpi removed in 0.8.0 — test deleted.

  it("flaker status --help shows user-facing status options", () => {
    const help = execSync(`node ${cliPath} status --help`, { encoding: "utf-8" });
    expect(help).toContain("--window-days");
    expect(help).toContain("--json");
  });

  // gate review/explain/history removed in 0.8.0 — tests deleted.
  // quarantine suggest/apply removed in 0.8.0 — tests deleted.

  it("flaker ops weekly --help shows ops weekly options", () => {
    const help = execSync(`node ${cliPath} ops weekly --help`, { encoding: "utf-8" });
    expect(help).toContain("--window-days");
    expect(help).toContain("--json");
  });

  it("flaker ops daily --help shows ops daily options", () => {
    const help = execSync(`node ${cliPath} ops daily --help`, { encoding: "utf-8" });
    expect(help).toContain("--window-days");
    expect(help).toContain("--json");
  });

  it("flaker ops incident --help shows ops incident options", () => {
    const help = execSync(`node ${cliPath} ops incident --help`, { encoding: "utf-8" });
    expect(help).toContain("--suite");
    expect(help).toContain("--test");
    expect(help).toContain("--run");
  });

  it("flaker doctor --help shows the canonical doctor command (not deprecated)", () => {
    const help = execSync(`node ${cliPath} doctor --help`, { encoding: "utf-8" });
    expect(help).toContain("Check runtime requirements");
    expect(help).not.toContain("DEPRECATED");
  });

  // collect CLI form removed in 0.8.0 — test deleted.
});
