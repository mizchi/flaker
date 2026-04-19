import { describe, expect, it } from "vitest";
import { computeStateDiff, type DesiredState, type ObservedState } from "../../src/cli/commands/apply/state.js";
import { DEFAULT_PROMOTION } from "../../src/cli/config.js";

function desired(overrides: Partial<DesiredState> = {}): DesiredState {
  return {
    promotion: DEFAULT_PROMOTION,
    quarantineAuto: true,
    samplingStrategy: "hybrid",
    hasGithubToken: true,
    ...overrides,
  };
}

function observed(overrides: Partial<ObservedState> = {}): ObservedState {
  return {
    matchedCommits: 0,
    falseNegativeRatePercentage: null,
    passCorrelationPercentage: null,
    holdoutFnrPercentage: null,
    dataConfidence: "insufficient",
    hasLocalHistory: false,
    staleDays: null,
    pendingQuarantineCount: 0,
    ...overrides,
  };
}

describe("computeStateDiff", () => {
  it("ok=true when every observed matches desired", () => {
    const diff = computeStateDiff(
      desired(),
      observed({
        matchedCommits: 30,
        falseNegativeRatePercentage: 3,
        passCorrelationPercentage: 97,
        holdoutFnrPercentage: 5,
        dataConfidence: "high",
        hasLocalHistory: true,
        staleDays: 0,
        pendingQuarantineCount: 0,
      }),
    );
    expect(diff.ok).toBe(true);
    expect(diff.drifts).toHaveLength(0);
  });

  it("flags matched_commits when below threshold", () => {
    const diff = computeStateDiff(
      desired(),
      observed({ matchedCommits: 10, hasLocalHistory: true, dataConfidence: "low", staleDays: 0 }),
    );
    const kinds = diff.drifts.map((d) => d.kind);
    expect(kinds).toContain("matched_commits");
    const mc = diff.drifts.find((d) => d.kind === "matched_commits");
    expect(mc).toMatchObject({ kind: "matched_commits", actual: 10, desired: 20 });
  });

  it("flags local_history_missing when hasLocalHistory=false", () => {
    const diff = computeStateDiff(desired(), observed({ hasLocalHistory: false }));
    expect(diff.drifts.map((d) => d.kind)).toContain("local_history_missing");
  });

  it("flags data_confidence when below desired minimum", () => {
    const diff = computeStateDiff(
      desired(),
      observed({
        matchedCommits: 30,
        falseNegativeRatePercentage: 3,
        passCorrelationPercentage: 97,
        holdoutFnrPercentage: 5,
        dataConfidence: "low",
        hasLocalHistory: true,
        staleDays: 0,
      }),
    );
    expect(diff.drifts.map((d) => d.kind)).toContain("data_confidence");
  });

  it("flags quarantine_pending when pendingQuarantineCount > 0 AND quarantineAuto=true", () => {
    const diff = computeStateDiff(
      desired(),
      observed({
        matchedCommits: 30,
        falseNegativeRatePercentage: 3,
        passCorrelationPercentage: 97,
        holdoutFnrPercentage: 5,
        dataConfidence: "high",
        hasLocalHistory: true,
        staleDays: 0,
        pendingQuarantineCount: 3,
      }),
    );
    expect(diff.drifts.map((d) => d.kind)).toContain("quarantine_pending");
  });

  it("does NOT flag quarantine_pending when quarantineAuto=false", () => {
    const diff = computeStateDiff(
      desired({ quarantineAuto: false }),
      observed({
        matchedCommits: 30,
        falseNegativeRatePercentage: 3,
        passCorrelationPercentage: 97,
        holdoutFnrPercentage: 5,
        dataConfidence: "high",
        hasLocalHistory: true,
        staleDays: 0,
        pendingQuarantineCount: 3,
      }),
    );
    expect(diff.drifts.map((d) => d.kind)).not.toContain("quarantine_pending");
  });

  it("flags history_stale when staleDays > 0 AND hasGithubToken=true", () => {
    const diff = computeStateDiff(
      desired(),
      observed({
        matchedCommits: 30,
        falseNegativeRatePercentage: 3,
        passCorrelationPercentage: 97,
        holdoutFnrPercentage: 5,
        dataConfidence: "high",
        hasLocalHistory: true,
        staleDays: 5,
      }),
    );
    expect(diff.drifts.map((d) => d.kind)).toContain("history_stale");
  });

  it("does NOT flag history_stale when hasGithubToken=false", () => {
    const diff = computeStateDiff(
      desired({ hasGithubToken: false }),
      observed({
        matchedCommits: 30,
        falseNegativeRatePercentage: 3,
        passCorrelationPercentage: 97,
        holdoutFnrPercentage: 5,
        dataConfidence: "high",
        hasLocalHistory: true,
        staleDays: 5,
      }),
    );
    expect(diff.drifts.map((d) => d.kind)).not.toContain("history_stale");
  });
});
