import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { FlakerConfig } from "../../src/cli/config.js";
import type { RunnerAdapter } from "../../src/cli/runners/types.js";
import type { TestResult, WorkflowRun } from "../../src/cli/storage/types.js";
import { formatOpsWeeklyReport, runOpsWeekly } from "../../src/cli/commands/ops/weekly.js";

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
      local: { strategy: "affected", max_duration_seconds: 20, fallback_strategy: "weighted" },
      ci: { strategy: "hybrid", sample_percentage: 25, adaptive: true, max_duration_seconds: 600 },
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
  retryCount: number = 0,
): TestResult {
  return {
    workflowRunId,
    suite,
    testName,
    status,
    durationMs: 100,
    retryCount,
    errorMessage: status === "failed" ? "boom" : null,
    commitSha,
    variant: null,
    createdAt,
  };
}

describe("ops weekly", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("builds a weekly review artifact with gate, quarantine, flaky-tag, and actions", async () => {
    const now = new Date("2026-04-19T00:00:00Z");
    await store.insertWorkflowRun(makeRun(1, "sha-1", now));

    await store.insertTestResults([
      makeResult(1, "tests/add.spec.ts", "add candidate", "failed", "sha-1", now),
      makeResult(1, "tests/add.spec.ts", "add candidate", "failed", "sha-1", now),
      makeResult(1, "tests/add.spec.ts", "add candidate", "passed", "sha-1", now, 1),
      makeResult(1, "tests/add.spec.ts", "add candidate", "passed", "sha-1", now),
      makeResult(1, "tests/add.spec.ts", "add candidate", "passed", "sha-1", now),

      makeResult(1, "tests/tagged.spec.ts", "tagged stable", "passed", "sha-1", now),
      makeResult(1, "tests/tagged.spec.ts", "tagged stable", "passed", "sha-1", now),
      makeResult(1, "tests/tagged.spec.ts", "tagged stable", "passed", "sha-1", now),
    ]);

    const runner: RunnerAdapter = {
      name: "playwright",
      capabilities: { nativeParallel: true },
      async listTests() {
        return [
          { suite: "tests/add.spec.ts", testName: "add candidate", taskId: "tests/add.spec.ts" },
          { suite: "tests/tagged.spec.ts", testName: "tagged stable", taskId: "tests/tagged.spec.ts", tags: ["@flaky"] },
        ];
      },
      async execute() {
        throw new Error("not used");
      },
    };

    const report = await runOpsWeekly({
      store,
      config: makeConfig(),
      runner,
      now,
      windowDays: 7,
      cwd: process.cwd(),
    });

    expect(report.scope).toEqual({ branch: "main", days: 7 });
    expect(report.mergeGate).toEqual(
      expect.objectContaining({
        gate: "merge",
      }),
    );
    expect(report.flakyTagSuggestions.summary.addCandidateCount).toBe(1);
    expect(report.flakyTagSuggestions.summary.removeCandidateCount).toBe(1);
    expect(report.quarantineSuggestions.add).toHaveLength(1);
    expect(report.recommendedActions.length).toBeGreaterThan(0);

    const text = formatOpsWeeklyReport(report);
    expect(text).toContain("Ops Weekly");
    expect(text).toContain("Recommended actions");
  });
});
