import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../src/cli/config.js";
import { detectProfileName, resolveProfile, computeAdaptivePercentage } from "../../src/cli/profile.js";
import type { AdaptiveSignals } from "../../src/cli/profile.js";

// --- Task 1: ProfileConfig type and TOML parsing ---

describe("loadConfig with profile sections", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flaker-profile-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses [profile.*] sections into config.profile", () => {
    writeFileSync(
      join(dir, "flaker.toml"),
      `
[repo]
owner = "test"
name = "repo"

[storage]
path = ".flaker/data"

[adapter]
type = "playwright"

[runner]
type = "vitest"
command = "pnpm test"

[affected]
resolver = "git"
config = ""

[quarantine]
auto = true
flaky_rate_threshold_percentage = 30
min_runs = 5

[flaky]
window_days = 14
detection_threshold_ratio = 0.02

[profile.scheduled]
strategy = "random"
sample_percentage = 30

[profile.ci]
strategy = "full"
max_duration_seconds = 300

[profile.local]
strategy = "random"
sample_percentage = 10
adaptive = true
adaptive_fnr_low_ratio = 0.01
adaptive_fnr_high_ratio = 0.04
`.trim(),
    );

    const config = loadConfig(dir);

    expect(config.profile).toBeDefined();
    expect(config.profile?.["scheduled"]).toEqual({
      strategy: "random",
      sample_percentage: 30,
    });
    expect(config.profile?.["ci"]).toEqual({
      strategy: "full",
      max_duration_seconds: 300,
    });
    expect(config.profile?.["local"]).toMatchObject({
      strategy: "random",
      sample_percentage: 10,
      adaptive: true,
      adaptive_fnr_low_ratio: 0.01,
      adaptive_fnr_high_ratio: 0.04,
    });
  });

  it("backward compat: no profile sections → profile is undefined", () => {
    writeFileSync(
      join(dir, "flaker.toml"),
      `
[repo]
owner = "test"
name = "repo"

[storage]
path = ".flaker/data"

[adapter]
type = "playwright"

[runner]
type = "vitest"
command = "pnpm test"

[affected]
resolver = "git"
config = ""

[quarantine]
auto = true
flaky_rate_threshold_percentage = 30
min_runs = 5

[flaky]
window_days = 14
detection_threshold_ratio = 0.02
`.trim(),
    );

    const config = loadConfig(dir);
    expect(config.profile).toBeUndefined();
  });
});

// --- Task 2: Profile resolution module ---

describe("detectProfileName", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear relevant env vars
    delete process.env["FLAKER_PROFILE"];
    delete process.env["CI"];
    delete process.env["GITHUB_ACTIONS"];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns explicit name when provided", () => {
    expect(detectProfileName("scheduled")).toBe("scheduled");
  });

  it("returns FLAKER_PROFILE env var when set", () => {
    process.env["FLAKER_PROFILE"] = "nightly";
    expect(detectProfileName(undefined)).toBe("nightly");
  });

  it("returns 'ci' when CI=true", () => {
    process.env["CI"] = "true";
    expect(detectProfileName(undefined)).toBe("ci");
  });

  it("returns 'ci' when GITHUB_ACTIONS=true", () => {
    process.env["GITHUB_ACTIONS"] = "true";
    expect(detectProfileName(undefined)).toBe("ci");
  });

  it("explicit overrides FLAKER_PROFILE env var", () => {
    process.env["FLAKER_PROFILE"] = "nightly";
    expect(detectProfileName("scheduled")).toBe("scheduled");
  });

  it("explicit overrides CI env var", () => {
    process.env["CI"] = "true";
    expect(detectProfileName("local")).toBe("local");
  });

  it("returns 'local' as default when nothing is set", () => {
    expect(detectProfileName(undefined)).toBe("local");
  });
});

describe("resolveProfile", () => {
  it("uses strategy from profile config", () => {
    const result = resolveProfile("ci", { ci: { strategy: "full" } }, undefined);
    expect(result.name).toBe("ci");
    expect(result.strategy).toBe("full");
  });

  it("forces sample_percentage=100 and holdout_ratio=0 when strategy is 'full'", () => {
    const result = resolveProfile("ci", { ci: { strategy: "full" } }, undefined);
    expect(result.sample_percentage).toBe(100);
    expect(result.holdout_ratio).toBe(0);
  });

  it("merges profile over sampling defaults", () => {
    const result = resolveProfile(
      "scheduled",
      { scheduled: { strategy: "random", sample_percentage: 30 } },
      { strategy: "random", sample_percentage: 50, holdout_ratio: 0.1 },
    );
    expect(result.strategy).toBe("random");
    expect(result.sample_percentage).toBe(30); // profile wins
    expect(result.holdout_ratio).toBe(0.1); // from sampling
  });

  it("falls back to sampling strategy when profile not found", () => {
    const result = resolveProfile("unknown", {}, { strategy: "random", sample_percentage: 20 });
    expect(result.strategy).toBe("random");
    expect(result.sample_percentage).toBe(20);
  });

  it("provides adaptive field defaults", () => {
    const result = resolveProfile("local", { local: { strategy: "random" } }, undefined);
    expect(result.adaptive).toBe(false);
    expect(result.adaptive_fnr_low_ratio).toBe(0.02);
    expect(result.adaptive_fnr_high_ratio).toBe(0.05);
    expect(result.adaptive_min_percentage).toBe(10);
    expect(result.adaptive_step).toBe(5);
  });

  it("uses adaptive values from profile config", () => {
    const result = resolveProfile(
      "local",
      {
        local: {
          strategy: "random",
          adaptive: true,
          adaptive_fnr_low_ratio: 0.01,
          adaptive_fnr_high_ratio: 0.04,
          adaptive_min_percentage: 5,
          adaptive_step: 2,
        },
      },
      undefined,
    );
    expect(result.adaptive).toBe(true);
    expect(result.adaptive_fnr_low_ratio).toBe(0.01);
    expect(result.adaptive_fnr_high_ratio).toBe(0.04);
    expect(result.adaptive_min_percentage).toBe(5);
    expect(result.adaptive_step).toBe(2);
  });

  it("handles max_duration_seconds and fallback_strategy", () => {
    const result = resolveProfile(
      "ci",
      { ci: { strategy: "full", max_duration_seconds: 300, fallback_strategy: "random" } },
      undefined,
    );
    expect(result.max_duration_seconds).toBe(300);
    expect(result.fallback_strategy).toBe("random");
  });

  it("uses 'weighted' as default strategy when no profile or sampling", () => {
    const result = resolveProfile("nonexistent", undefined, undefined);
    expect(result.strategy).toBe("weighted");
  });
});

describe("computeAdaptivePercentage", () => {
  const defaultOpts = {
    basePercentage: 30,
    fnrLow: 0.02,
    fnrHigh: 0.05,
    minPercentage: 10,
    step: 5,
  };

  it("reduces percentage when FNR is below low threshold", () => {
    const result = computeAdaptivePercentage({ falseNegativeRate: 0.01, divergenceRate: null }, defaultOpts);
    expect(result.percentage).toBe(25);
  });

  it("keeps percentage when FNR is between thresholds", () => {
    const result = computeAdaptivePercentage({ falseNegativeRate: 0.03, divergenceRate: null }, defaultOpts);
    expect(result.percentage).toBe(30);
  });

  it("increases percentage when FNR exceeds high threshold", () => {
    const result = computeAdaptivePercentage({ falseNegativeRate: 0.06, divergenceRate: null }, { ...defaultOpts, basePercentage: 20 });
    expect(result.percentage).toBe(25);
  });

  it("never goes below minPercentage", () => {
    const result = computeAdaptivePercentage({ falseNegativeRate: 0.001, divergenceRate: null }, { ...defaultOpts, basePercentage: 12, minPercentage: 10 });
    expect(result.percentage).toBeGreaterThanOrEqual(10);
  });

  it("returns base percentage when both signals are null (no data)", () => {
    const result = computeAdaptivePercentage({ falseNegativeRate: null, divergenceRate: null }, defaultOpts);
    expect(result.percentage).toBe(30);
    expect(result.reason).toContain("no data");
  });

  it("uses divergence rate when FNR is null", () => {
    const result = computeAdaptivePercentage({ falseNegativeRate: null, divergenceRate: 0.06 }, { ...defaultOpts, basePercentage: 20 });
    expect(result.percentage).toBe(25);
    expect(result.reason).toContain("divergence");
  });

  it("uses worse signal when both present", () => {
    const result = computeAdaptivePercentage({ falseNegativeRate: 0.01, divergenceRate: 0.08 }, { ...defaultOpts, basePercentage: 20 });
    expect(result.percentage).toBe(25);
    expect(result.reason).toContain("divergence");
  });

  it("reduces when both signals are low", () => {
    const result = computeAdaptivePercentage({ falseNegativeRate: 0.005, divergenceRate: 0.01 }, { ...defaultOpts, basePercentage: 30 });
    expect(result.percentage).toBe(25);
  });

  it("reason includes both signal values when both present", () => {
    const result = computeAdaptivePercentage({ falseNegativeRate: 0.03, divergenceRate: 0.04 }, defaultOpts);
    expect(result.reason).toContain("FNR");
    expect(result.reason).toContain("divergence");
  });
});
