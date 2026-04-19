import { describe, expect, it } from "vitest";
import type { FlakerConfig } from "../../src/cli/config.js";
import type { ResolvedProfile } from "../../src/cli/profile-compat.js";
import { buildGateExplain } from "../../src/cli/commands/gate/explain.js";

function makeConfig(): FlakerConfig {
  return {
    repo: { owner: "owner", name: "repo" },
    storage: { path: ".flaker/data" },
    adapter: { type: "playwright" },
    runner: { type: "playwright", command: "pnpm exec playwright test", flaky_tag_pattern: "@flaky" },
    affected: { resolver: "git", config: "" },
    quarantine: { auto: true, flaky_rate_threshold_percentage: 30, min_runs: 5 },
    flaky: { window_days: 30, detection_threshold_ratio: 0.02 },
    sampling: {
      strategy: "hybrid",
      sample_percentage: 25,
      holdout_ratio: 0.1,
      co_failure_window_days: 90,
      cluster_mode: "spread",
      skip_quarantined: true,
      skip_flaky_tagged: true,
    },
    profile: {
      ci: {
        strategy: "hybrid",
        sample_percentage: 20,
        adaptive: true,
        max_duration_seconds: 600,
      },
    },
  };
}

function makeProfile(overrides?: Partial<ResolvedProfile>): ResolvedProfile {
  return {
    name: "ci",
    strategy: "hybrid",
    sample_percentage: 20,
    holdout_ratio: 0.1,
    co_failure_window_days: 90,
    cluster_mode: "spread",
    model_path: undefined,
    skip_quarantined: true,
    skip_flaky_tagged: true,
    adaptive: true,
    adaptive_fnr_low_ratio: 0.02,
    adaptive_fnr_high_ratio: 0.05,
    adaptive_min_percentage: 10,
    adaptive_step: 5,
    max_duration_seconds: 600,
    fallback_strategy: undefined,
    ...overrides,
  };
}

describe("gate explain", () => {
  it("reports resolved values and their sources", () => {
    const report = buildGateExplain({
      gate: "merge",
      config: makeConfig(),
      profile: makeProfile(),
    });

    expect(report.gate).toBe("merge");
    expect(report.backingProfile).toBe("ci");
    expect(report.resolved.strategy.value).toBe("hybrid");
    expect(report.resolved.strategy.source).toBe("profile.ci");
    expect(report.resolved.samplePercentage.value).toBe(20);
    expect(report.resolved.samplePercentage.source).toBe("profile.ci");
    expect(report.resolved.holdoutRatio.source).toBe("sampling");
    expect(report.resolved.maxDurationSeconds.source).toBe("profile.ci");
    expect(report.migrationHints.join(" ")).toContain("[profile.*]");
  });

  it("marks full strategy derived values as derived", () => {
    const report = buildGateExplain({
      gate: "release",
      config: {
        ...makeConfig(),
        profile: {
          scheduled: { strategy: "full", max_duration_seconds: 1800 },
        },
      },
      profile: makeProfile({
        name: "scheduled",
        strategy: "full",
        sample_percentage: 100,
        holdout_ratio: 0,
        max_duration_seconds: 1800,
        adaptive: false,
      }),
    });

    expect(report.resolved.samplePercentage.source).toBe("derived(full-strategy)");
    expect(report.resolved.holdoutRatio.source).toBe("derived(full-strategy)");
  });
});
