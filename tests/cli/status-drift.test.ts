import { describe, expect, it } from "vitest";
import { computeDrift } from "../../src/cli/commands/status/summary.js";
import { DEFAULT_PROMOTION } from "../../src/cli/config.js";

describe("computeDrift", () => {
  it("flags every unmet threshold", () => {
    const drift = computeDrift(
      {
        matchedCommits: 10,
        falseNegativeRatePercentage: 8,
        passCorrelationPercentage: 90,
        holdoutFnrPercentage: 15,
        dataConfidence: "low",
      },
      DEFAULT_PROMOTION,
    );
    expect(drift.ok).toBe(false);
    expect(drift.unmet.map((u) => u.field)).toEqual([
      "matched_commits",
      "false_negative_rate",
      "pass_correlation",
      "holdout_fnr",
      "data_confidence",
    ]);
  });

  it("returns ok=true when all thresholds are met", () => {
    const drift = computeDrift(
      {
        matchedCommits: 30,
        falseNegativeRatePercentage: 3,
        passCorrelationPercentage: 97,
        holdoutFnrPercentage: 5,
        dataConfidence: "high",
      },
      DEFAULT_PROMOTION,
    );
    expect(drift.ok).toBe(true);
    expect(drift.unmet).toHaveLength(0);
  });

  it("treats null metrics as unmet", () => {
    const drift = computeDrift(
      {
        matchedCommits: 30,
        falseNegativeRatePercentage: null,
        passCorrelationPercentage: null,
        holdoutFnrPercentage: null,
        dataConfidence: "moderate",
      },
      DEFAULT_PROMOTION,
    );
    expect(drift.ok).toBe(false);
    expect(drift.unmet.map((u) => u.field)).toContain("false_negative_rate");
    expect(drift.unmet.map((u) => u.field)).toContain("pass_correlation");
    expect(drift.unmet.map((u) => u.field)).toContain("holdout_fnr");
  });

  it("treats data_confidence=insufficient as unmet when threshold is moderate", () => {
    const drift = computeDrift(
      {
        matchedCommits: 30,
        falseNegativeRatePercentage: 3,
        passCorrelationPercentage: 97,
        holdoutFnrPercentage: 5,
        dataConfidence: "insufficient",
      },
      DEFAULT_PROMOTION,
    );
    expect(drift.unmet.map((u) => u.field)).toContain("data_confidence");
  });
});
