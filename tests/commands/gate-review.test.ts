import { describe, expect, it } from "vitest";
import { buildGateReview } from "../../src/cli/commands/gate/review.js";
import type { ResolvedProfile } from "../../src/cli/profile-compat.js";
import type { FlakerKpi } from "../../src/cli/commands/analyze/kpi.js";

function makeProfile(overrides?: Partial<ResolvedProfile>): ResolvedProfile {
  return {
    name: "ci",
    strategy: "hybrid",
    sample_percentage: 25,
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
    fallback_strategy: "weighted",
    ...overrides,
  };
}

function makeKpi(overrides?: Partial<FlakerKpi>): FlakerKpi {
  return {
    timestamp: "2026-04-19T00:00:00.000Z",
    windowDays: 30,
    sampling: {
      matchedCommits: 24,
      recall: 96,
      falsePositiveRate: 4.2,
      falseNegativeRate: 3,
      sampleRatio: 28.4,
      passCorrelation: 97,
      holdoutFNR: 5.1,
      skippedMinutes: 14.2,
      confusionMatrix: {
        truePositive: 12,
        falsePositive: 3,
        falseNegative: 2,
        trueNegative: 40,
      },
    },
    flaky: {
      brokenTests: 1,
      intermittentFlaky: 2,
      trueFlakyRate: 8.2,
      flakyTrend: -1.5,
    },
    data: {
      commitCount: 30,
      commitsWithChanges: 28,
      coFailureCoverage: 92,
      coFailureReady: true,
      confidence: "high",
      lastDataAt: "2026-04-19T00:00:00.000Z",
      staleDays: 0,
    },
    ...overrides,
  };
}

describe("gate review", () => {
  it("marks merge gate as ready to promote when signals clear thresholds", () => {
    const report = buildGateReview({
      gate: "merge",
      profile: makeProfile(),
      kpi: makeKpi(),
    });

    expect(report.gate).toBe("merge");
    expect(report.backingProfile).toBe("ci");
    expect(report.promotionReadiness.status).toBe("ready");
    expect(report.recommendedAction).toBe("promote");
    expect(report.kpi.falseNegativeRateRatio).toBe(0.03);
    expect(report.kpi.passCorrelationRatio).toBe(0.97);
  });

  it("returns insufficient_data when matched history is too small", () => {
    const report = buildGateReview({
      gate: "merge",
      profile: makeProfile(),
      kpi: makeKpi({
        sampling: {
          ...makeKpi().sampling,
          matchedCommits: 8,
        },
        data: {
          ...makeKpi().data,
          confidence: "moderate",
        },
      }),
    });

    expect(report.promotionReadiness.status).toBe("insufficient_data");
    expect(report.recommendedAction).toBe("keep");
    expect(report.promotionReadiness.checks[0]).toEqual(
      expect.objectContaining({ name: "matched_commits", status: "fail" }),
    );
  });

  it("returns demote when false negative rate is above threshold", () => {
    const report = buildGateReview({
      gate: "merge",
      profile: makeProfile(),
      kpi: makeKpi({
        sampling: {
          ...makeKpi().sampling,
          falseNegativeRate: 8,
        },
      }),
    });

    expect(report.promotionReadiness.status).toBe("demote");
    expect(report.recommendedAction).toBe("demote");
    expect(report.demotionRisk.status).toBe("high");
    expect(report.demotionRisk.reasons.join(" ")).toContain("false negative rate");
  });
});
