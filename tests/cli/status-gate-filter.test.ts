import { describe, expect, it } from "vitest";
import { formatStatusSummary } from "../../src/cli/commands/status/summary.js";

describe("formatStatusSummary with filtered gates", () => {
  it("does not crash when only one gate is present", () => {
    const summary: any = {
      generatedAt: "2026-04-19T00:00:00Z",
      windowDays: 30,
      activity: { totalRuns: 0, ciRuns: 0, localRuns: 0, passedResults: 0, failedResults: 0 },
      health: { dataConfidence: "low", matchedCommits: 0, sampleRatio: null, brokenTests: 0, intermittentFlaky: 0, flakyTrend: 0 },
      gates: {
        merge: { profile: "ci", strategy: "hybrid", samplePercentage: 30, maxDurationSeconds: null, adaptive: true },
      },
      quarantine: { currentCount: 0, pendingAddCount: 0, pendingRemoveCount: 0 },
      drift: { ok: false, unmet: [] },
    };
    const text = formatStatusSummary(summary);
    expect(text).toContain("merge:");
    expect(text).not.toContain("iteration:");
    expect(text).not.toContain("release:");
  });

  it("shows all three gates when gates is the full set", () => {
    const summary: any = {
      generatedAt: "2026-04-19T00:00:00Z",
      windowDays: 30,
      activity: { totalRuns: 0, ciRuns: 0, localRuns: 0, passedResults: 0, failedResults: 0 },
      health: { dataConfidence: "low", matchedCommits: 0, sampleRatio: null, brokenTests: 0, intermittentFlaky: 0, flakyTrend: 0 },
      gates: {
        iteration: { profile: "local", strategy: "random", samplePercentage: 20, maxDurationSeconds: 60, adaptive: false },
        merge: { profile: "ci", strategy: "hybrid", samplePercentage: 30, maxDurationSeconds: null, adaptive: true },
        release: { profile: "full", strategy: "full", samplePercentage: null, maxDurationSeconds: null, adaptive: false },
      },
      quarantine: { currentCount: 0, pendingAddCount: 0, pendingRemoveCount: 0 },
      drift: { ok: true, unmet: [] },
    };
    const text = formatStatusSummary(summary);
    expect(text).toContain("iteration:");
    expect(text).toContain("merge:");
    expect(text).toContain("release:");
  });
});

describe("statusAction gate validation", () => {
  it("VALID_GATE_NAMES contains the three canonical gates and not arbitrary strings", async () => {
    const { VALID_GATE_NAMES } = await import("../../src/cli/gate.js");
    expect(VALID_GATE_NAMES).toContain("iteration");
    expect(VALID_GATE_NAMES).toContain("merge");
    expect(VALID_GATE_NAMES).toContain("release");
    expect((VALID_GATE_NAMES as readonly string[]).includes("bogus")).toBe(false);
  });
});
