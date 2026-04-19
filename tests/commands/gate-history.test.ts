import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { FlakerConfig } from "../../src/cli/config.js";
import type { WorkflowRun, TestResult } from "../../src/cli/storage/types.js";
import { formatGateHistory, runGateHistory } from "../../src/cli/commands/gate/history.js";

function makeConfig(): FlakerConfig {
  return {
    repo: { owner: "owner", name: "repo" },
    storage: { path: ":memory:" },
    adapter: { type: "playwright" },
    runner: { type: "playwright", command: "pnpm exec playwright test", flaky_tag_pattern: "@flaky" },
    affected: { resolver: "git", config: "" },
    quarantine: { auto: true, flaky_rate_threshold_percentage: 30, min_runs: 5 },
    flaky: { window_days: 30, detection_threshold_ratio: 0.02 },
    sampling: {
      strategy: "hybrid",
      sample_percentage: 25,
      holdout_ratio: 0.1,
      skip_quarantined: true,
      skip_flaky_tagged: true,
    },
    profile: {
      ci: { strategy: "hybrid", sample_percentage: 25, adaptive: true, max_duration_seconds: 600 },
      local: { strategy: "affected", max_duration_seconds: 20, fallback_strategy: "weighted" },
      scheduled: { strategy: "full", max_duration_seconds: 1800 },
    },
  };
}

function makeRun(
  id: number,
  commitSha: string,
  createdAt: Date,
  overrides?: Partial<WorkflowRun>,
): WorkflowRun {
  return {
    id,
    repo: "owner/repo",
    branch: "main",
    commitSha,
    event: "push",
    source: "ci",
    status: "success",
    createdAt,
    durationMs: 60_000,
    ...overrides,
  };
}

function makeResult(
  workflowRunId: number,
  suite: string,
  testName: string,
  status: string,
  commitSha: string,
  createdAt: Date,
): TestResult {
  return {
    workflowRunId,
    suite,
    testName,
    status,
    durationMs: 100,
    retryCount: 0,
    errorMessage: status === "failed" ? "boom" : null,
    commitSha,
    variant: null,
    createdAt,
  };
}

describe("gate history", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("aggregates daily outcomes and sample ratio trend for merge gate", async () => {
    const day1 = new Date("2026-04-18T12:00:00Z");
    const day2 = new Date("2026-04-19T12:00:00Z");

    await store.insertWorkflowRun(makeRun(1, "sha-1", day1));
    await store.insertWorkflowRun(makeRun(2, "sha-2", day2, { status: "failure" }));

    await store.insertTestResults([
      makeResult(1, "tests/a.spec.ts", "a", "passed", "sha-1", day1),
      makeResult(1, "tests/b.spec.ts", "b", "passed", "sha-1", day1),
      makeResult(2, "tests/a.spec.ts", "a", "failed", "sha-2", day2),
      makeResult(2, "tests/b.spec.ts", "b", "passed", "sha-2", day2),
    ]);

    await store.recordSamplingRun({
      commitSha: "sha-1",
      commandKind: "run",
      strategy: "hybrid",
      candidateCount: 10,
      selectedCount: 3,
      sampleRatio: 30,
      createdAt: day1,
    });
    await store.recordSamplingRun({
      commitSha: "sha-2",
      commandKind: "run",
      strategy: "hybrid",
      candidateCount: 10,
      selectedCount: 2,
      sampleRatio: 20,
      createdAt: day2,
    });

    const report = await runGateHistory({
      store,
      gate: "merge",
      config: makeConfig(),
      windowDays: 30,
    });

    expect(report.gate).toBe("merge");
    expect(report.backingProfile).toBe("ci");
    expect(report.entries).toHaveLength(2);
    expect(report.entries[0]).toEqual(
      expect.objectContaining({
        date: "2026-04-18",
        totalRuns: 1,
        passRate: 1,
        samplePercentage: 30,
      }),
    );
    expect(report.entries[1]).toEqual(
      expect.objectContaining({
        date: "2026-04-19",
        totalRuns: 1,
        failureRate: 0.5,
        samplePercentage: 20,
      }),
    );

    const text = formatGateHistory(report);
    expect(text).toContain("Gate History: merge");
    expect(text).toContain("2026-04-18");
    expect(text).toContain("30%");
  });
});
