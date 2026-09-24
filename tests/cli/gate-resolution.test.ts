import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../src/cli/config.js";
import { resolveGate, resolveGateName } from "../../src/cli/gate-config.js";
import { LEGACY_PROFILE_TO_GATE } from "../../src/cli/gate.js";
import {
  computeAdaptivePercentage,
} from "../../src/cli/adaptive.js";

describe("loadConfig with gate sections", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flaker-gate-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses [gate.*] sections into config.gate", () => {
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
type = "playwright"
command = "pnpm exec playwright test"
flaky_tag_pattern = "@flaky"

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

[gate.release]
strategy = "random"
sample_percentage = 30
cluster_mode = "spread"

[gate.merge]
strategy = "full"
max_duration_seconds = 300

[gate.iteration]
strategy = "random"
sample_percentage = 10
cluster_mode = "pack"
adaptive = true
adaptive_fnr_low_ratio = 0.01
adaptive_fnr_high_ratio = 0.04
skip_flaky_tagged = true
`.trim(),
    );

    const config = loadConfig(dir);

    expect(config.gate).toBeDefined();
    expect(config.gate?.release).toEqual({
      strategy: "random",
      sample_percentage: 30,
      cluster_mode: "spread",
    });
    expect(config.gate?.merge).toEqual({
      strategy: "full",
      max_duration_seconds: 300,
    });
    expect(config.gate?.iteration).toMatchObject({
      strategy: "random",
      sample_percentage: 10,
      cluster_mode: "pack",
      adaptive: true,
      adaptive_fnr_low_ratio: 0.01,
      adaptive_fnr_high_ratio: 0.04,
      skip_flaky_tagged: true,
    });
    expect(config.runner.flaky_tag_pattern).toBe("@flaky");
  });

  it("no gate sections → gate is undefined", () => {
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
    expect(config.gate).toBeUndefined();
  });
});

describe("resolveGateName", () => {
  it("returns the explicit gate when provided", () => {
    expect(resolveGateName("release", {})).toBe("release");
  });

  it("normalizes case and whitespace", () => {
    expect(resolveGateName(" Merge ", {})).toBe("merge");
  });

  it("returns FLAKER_GATE when set", () => {
    expect(resolveGateName(undefined, { FLAKER_GATE: "release" })).toBe("release");
  });

  it("returns 'merge' when CI=true", () => {
    expect(resolveGateName(undefined, { CI: "true" })).toBe("merge");
  });

  it("returns 'merge' when GITHUB_ACTIONS=true", () => {
    expect(resolveGateName(undefined, { GITHUB_ACTIONS: "true" })).toBe("merge");
  });

  it("explicit overrides FLAKER_GATE", () => {
    expect(resolveGateName("release", { FLAKER_GATE: "merge" })).toBe("release");
  });

  it("explicit overrides CI env var", () => {
    expect(resolveGateName("iteration", { CI: "true" })).toBe("iteration");
  });

  it("returns 'iteration' as default when nothing is set", () => {
    expect(resolveGateName(undefined, {})).toBe("iteration");
  });

  it("rejects an unknown FLAKER_GATE value", () => {
    expect(() => resolveGateName(undefined, { FLAKER_GATE: "nightly" })).toThrow(/Unknown gate 'nightly'/);
  });

  it("rejects FLAKER_PROFILE even without a known mapping", () => {
    expect(() => resolveGateName("merge", { FLAKER_PROFILE: "nightly" })).toThrow(
      /FLAKER_PROFILE was replaced by FLAKER_GATE/,
    );
  });
});

describe("legacy profile → gate mapping", () => {
  it("maps each 0.12 profile to its gate", () => {
    expect(LEGACY_PROFILE_TO_GATE).toEqual({
      local: "iteration",
      ci: "merge",
      scheduled: "release",
    });
  });
});

describe("resolveGate", () => {
  it("uses strategy from gate config", () => {
    const result = resolveGate("merge", { merge: { strategy: "full" } }, undefined);
    expect(result.name).toBe("merge");
    expect(result.strategy).toBe("full");
  });

  it("forces sample_percentage=100 and holdout_ratio=0 when strategy is 'full'", () => {
    const result = resolveGate("merge", { merge: { strategy: "full" } }, undefined);
    expect(result.sample_percentage).toBe(100);
    expect(result.holdout_ratio).toBe(0);
  });

  it("merges gate over sampling defaults", () => {
    const result = resolveGate(
      "release",
      { release: { strategy: "random", sample_percentage: 30, cluster_mode: "spread" } },
      { strategy: "random", sample_percentage: 50, holdout_ratio: 0.1, cluster_mode: "pack", skip_quarantined: true, skip_flaky_tagged: true },
    );
    expect(result.strategy).toBe("random");
    expect(result.sample_percentage).toBe(30); // gate wins
    expect(result.holdout_ratio).toBe(0.1); // from sampling
    expect(result.cluster_mode).toBe("spread"); // gate wins
    expect(result.skip_flaky_tagged).toBe(true); // from sampling
  });

  it("allows gate to override skip_flaky_tagged", () => {
    const result = resolveGate(
      "merge",
      { merge: { strategy: "hybrid", skip_flaky_tagged: false } },
      { strategy: "hybrid", skip_flaky_tagged: true },
    );
    expect(result.skip_flaky_tagged).toBe(false);
  });

  it("falls back to sampling when the gate has no section", () => {
    const result = resolveGate("release", {}, { strategy: "random", sample_percentage: 20, cluster_mode: "pack" });
    expect(result.strategy).toBe("random");
    expect(result.sample_percentage).toBe(20);
    expect(result.cluster_mode).toBe("pack");
  });

  it("does not expose adaptive fields", () => {
    const result = resolveGate(
      "iteration",
      { iteration: { strategy: "random", adaptive: true, adaptive_step: 2 } },
      undefined,
    );
    expect(result).not.toHaveProperty("adaptive");
    expect(result).not.toHaveProperty("adaptive_step");
  });

  it("handles max_duration_seconds and fallback_strategy", () => {
    const result = resolveGate(
      "merge",
      { merge: { strategy: "full", max_duration_seconds: 300, fallback_strategy: "random" } },
      undefined,
    );
    expect(result.max_duration_seconds).toBe(300);
    expect(result.fallback_strategy).toBe("random");
  });

  it("uses 'weighted' as default strategy when no gate or sampling", () => {
    const result = resolveGate("release", undefined, undefined);
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
