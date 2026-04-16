import { describe, it, expect } from "vitest";
import { recommendSampling, type ProjectProfile } from "../../src/cli/commands/collect/calibrate.js";
import { writeSamplingConfig, loadConfig, type SamplingConfig } from "../../src/cli/config.js";
import { writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("recommendSampling", () => {
  it("recommends random for small test suites", () => {
    const profile: ProjectProfile = {
      testCount: 30,
      flakyRate: 0.05,
      coFailureStrength: 0.5,
      commitCount: 100,
      hasResolver: true,
      hasGBDTModel: false,
      trueFlakyRate: 0.05,
      hasCoFailureData: false,
      brokenTestCount: 0,
      intermittentFlakyCount: 0,
      confidence: "moderate" as const,
    };
    const result = recommendSampling(profile);
    expect(result.strategy).toBe("random");
  });

  it("recommends hybrid for low flaky rate with resolver", () => {
    const profile: ProjectProfile = {
      testCount: 200,
      flakyRate: 0.05,
      coFailureStrength: 0.7,
      commitCount: 100,
      hasResolver: true,
      hasGBDTModel: false,
      trueFlakyRate: 0.05,
      hasCoFailureData: false,
      brokenTestCount: 0,
      intermittentFlakyCount: 0,
      confidence: "moderate" as const,
    };
    const result = recommendSampling(profile);
    expect(result.strategy).toBe("hybrid");
    expect(result.sample_percentage).toBe(30);
    expect(result.holdout_ratio).toBe(0.1);
  });

  it("recommends gbdt for high flaky rate with model and history", () => {
    const profile: ProjectProfile = {
      testCount: 500,
      flakyRate: 0.25,
      trueFlakyRate: 0.25,
      coFailureStrength: 0.6,
      hasCoFailureData: true,
      commitCount: 200,
      hasResolver: false,
      hasGBDTModel: true,
      brokenTestCount: 0,
      intermittentFlakyCount: 125,
      confidence: "high" as const,
    };
    const result = recommendSampling(profile);
    expect(result.strategy).toBe("gbdt");
    expect(result.sample_percentage).toBe(20);
    expect(result.co_failure_window_days).toBe(60); // shorter window for high flaky
  });

  it("recommends weighted when no resolver or model", () => {
    const profile: ProjectProfile = {
      testCount: 200,
      flakyRate: 0.1,
      coFailureStrength: 0.5,
      commitCount: 50,
      hasResolver: false,
      hasGBDTModel: false,
      trueFlakyRate: 0.05,
      hasCoFailureData: false,
      brokenTestCount: 0,
      intermittentFlakyCount: 0,
      confidence: "moderate" as const,
    };
    const result = recommendSampling(profile);
    expect(result.strategy).toBe("weighted");
  });

  it("recommends hybrid for high flaky with resolver but no model", () => {
    const profile: ProjectProfile = {
      testCount: 300,
      flakyRate: 0.3,
      coFailureStrength: 0.8,
      commitCount: 200,
      hasResolver: true,
      hasGBDTModel: false,
      trueFlakyRate: 0.05,
      hasCoFailureData: false,
      brokenTestCount: 0,
      intermittentFlakyCount: 0,
      confidence: "moderate" as const,
    };
    const result = recommendSampling(profile);
    expect(result.strategy).toBe("hybrid");
  });

  it("sets calibrated_at to current date", () => {
    const profile: ProjectProfile = {
      testCount: 100,
      flakyRate: 0.05,
      coFailureStrength: 0.5,
      commitCount: 50,
      hasResolver: true,
      hasGBDTModel: false,
      trueFlakyRate: 0.05,
      hasCoFailureData: false,
      brokenTestCount: 0,
      intermittentFlakyCount: 0,
      confidence: "moderate" as const,
    };
    const result = recommendSampling(profile);
    expect(result.calibrated_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("writeSamplingConfig", () => {
  let dir: string;

  function setup(tomlContent: string): string {
    dir = join(tmpdir(), `flaker-calibrate-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "flaker.toml"), tomlContent, "utf-8");
    return dir;
  }

  it("appends [sampling] section to toml without existing section", () => {
    const d = setup(`[repo]\nowner = "test"\nname = "repo"\n`);
    const sampling: SamplingConfig = {
      strategy: "hybrid",
      sample_percentage: 20,
      holdout_ratio: 0.1,
      cluster_mode: "spread",
    };
    writeSamplingConfig(d, sampling);
    const content = readFileSync(join(d, "flaker.toml"), "utf-8");
    expect(content).toContain('[sampling]');
    expect(content).toContain('strategy = "hybrid"');
    expect(content).toContain('sample_percentage = 20');
    expect(content).toContain('holdout_ratio = 0.1');
    expect(content).toContain('cluster_mode = "spread"');
    // Original content preserved
    expect(content).toContain('[repo]');
    expect(content).toContain('owner = "test"');
    rmSync(d, { recursive: true, force: true });
  });

  it("replaces existing [sampling] section", () => {
    const d = setup(
      `[repo]\nowner = "test"\nname = "repo"\n\n[sampling]\nstrategy = "random"\npercentage = 50\n\n[runner]\ntype = "direct"\n`,
    );
    const sampling: SamplingConfig = {
      strategy: "gbdt",
      sample_percentage: 30,
    };
    writeSamplingConfig(d, sampling);
    const content = readFileSync(join(d, "flaker.toml"), "utf-8");
    expect(content).toContain('strategy = "gbdt"');
    expect(content).toContain('sample_percentage = 30');
    expect(content).not.toContain('strategy = "random"');
    expect(content).not.toContain('sample_percentage = 50');
    // Other sections preserved
    expect(content).toContain('[repo]');
    expect(content).toContain('[runner]');
    rmSync(d, { recursive: true, force: true });
  });
});

describe("resolveSamplingOpts integration", () => {
  it("loadConfig reads sampling section", () => {
    const dir = join(tmpdir(), `flaker-config-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "flaker.toml"),
      `[repo]\nowner = "test"\nname = "repo"\n\n[sampling]\nstrategy = "hybrid"\nsample_percentage = 25\nholdout_ratio = 0.05\nco_failure_window_days = 60\ncluster_mode = "pack"\n`,
      "utf-8",
    );
    const config = loadConfig(dir);
    expect(config.sampling).toBeDefined();
    expect(config.sampling!.strategy).toBe("hybrid");
    expect(config.sampling!.sample_percentage).toBe(25);
    expect(config.sampling!.holdout_ratio).toBe(0.05);
    expect(config.sampling!.co_failure_window_days).toBe(60);
    expect(config.sampling!.cluster_mode).toBe("pack");
    rmSync(dir, { recursive: true, force: true });
  });
});
