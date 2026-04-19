import { describe, expect, it } from "vitest";
import { formatStatusMarkdown } from "../../src/cli/commands/status/summary.js";

const sampleSummary: any = {
  generatedAt: "2026-04-19T00:00:00Z",
  windowDays: 30,
  activity: { totalRuns: 10, ciRuns: 5, localRuns: 5, passedResults: 100, failedResults: 2 },
  health: {
    dataConfidence: "moderate",
    matchedCommits: 25,
    sampleRatio: 40,
    brokenTests: 1,
    intermittentFlaky: 3,
    flakyTrend: -1,
  },
  gates: {
    iteration: { profile: "local", strategy: "affected", samplePercentage: null, maxDurationSeconds: 60, adaptive: false },
    merge:     { profile: "ci",    strategy: "hybrid",   samplePercentage: 30,   maxDurationSeconds: null, adaptive: true },
    release:   { profile: "scheduled", strategy: "full", samplePercentage: null, maxDurationSeconds: null, adaptive: false },
  },
  quarantine: { currentCount: 2, pendingAddCount: 1, pendingRemoveCount: 0 },
  drift: { ok: true, unmet: [] },
};

describe("formatStatusMarkdown", () => {
  it("renders Markdown with headers and tables", () => {
    const md = formatStatusMarkdown(sampleSummary);
    expect(md).toContain("# flaker Status");
    expect(md).toContain("## Activity");
    expect(md).toContain("| iteration |");
    expect(md).toContain("| merge |");
    expect(md).toContain("| release |");
    expect(md).toMatch(/data confidence.*moderate/i);
  });
});
