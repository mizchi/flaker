import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { DEFAULT_PROMOTION, type FlakerConfig } from "../../src/cli/config.js";
import type { TestResult, WorkflowRun } from "../../src/cli/storage/types.js";
import { formatStatusSummary, runStatusSummary } from "../../src/cli/commands/status/summary.js";

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
    promotion: DEFAULT_PROMOTION,
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
  overrides?: Partial<TestResult>,
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
    ...overrides,
  };
}

describe("status summary", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("builds a summary-only dashboard with gate config and quarantine counts", async () => {
    const now = new Date("2026-04-19T00:00:00Z");
    await store.insertWorkflowRun(makeRun(1, "sha-ci", now, { source: "ci", status: "success" }));
    await store.insertWorkflowRun(
      makeRun(2, "sha-local", now, {
        source: "local",
        event: "flaker-local-run",
        branch: "local",
        status: "failure",
      }),
    );

    await store.insertTestResults([
      makeResult(1, "tests/a.spec.ts", "stable", "passed", "sha-ci", now),
      makeResult(2, "tests/add.spec.ts", "add candidate", "failed", "sha-local", now),
      makeResult(2, "tests/add.spec.ts", "add candidate", "failed", "sha-local", now),
      makeResult(2, "tests/add.spec.ts", "add candidate", "passed", "sha-local", now, { retryCount: 1 }),
      makeResult(2, "tests/add.spec.ts", "add candidate", "passed", "sha-local", now),
      makeResult(2, "tests/add.spec.ts", "add candidate", "passed", "sha-local", now),
    ]);

    await store.addQuarantine({ suite: "tests/quarantined.spec.ts", testName: "known flaky" }, "manual");

    const summary = await runStatusSummary({
      store,
      config: makeConfig(),
      now,
      windowDays: 30,
    });

    expect(summary.activity.totalRuns).toBe(2);
    expect(summary.activity.ciRuns).toBe(1);
    expect(summary.activity.localRuns).toBe(1);
    expect(summary.activity.failedResults).toBe(3);
    expect(summary.gates.merge).toEqual(
      expect.objectContaining({
        profile: "ci",
        strategy: "hybrid",
        maxDurationSeconds: 600,
      }),
    );
    expect(summary.gates.release).toEqual(
      expect.objectContaining({
        profile: "scheduled",
        strategy: "full",
      }),
    );
    expect(summary.quarantine.currentCount).toBe(1);
    expect(summary.quarantine.pendingAddCount).toBe(1);
    expect(summary.quarantine.pendingRemoveCount).toBe(1);
    expect((summary as Record<string, unknown>)["recommendedAction"]).toBeUndefined();

    const rendered = formatStatusSummary(summary);
    expect(rendered).toContain("flaker Status");
    expect(rendered).toContain("total runs");
    expect(rendered).toContain("pending quarantine");
  });
});
