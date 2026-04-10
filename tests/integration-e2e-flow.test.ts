import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../src/cli/storage/duckdb.js";
import { runSample } from "../src/cli/commands/exec/plan.js";
import { runEval } from "../src/cli/commands/analyze/eval.js";
import { SimpleResolver } from "../src/cli/resolvers/simple.js";
import type { WorkflowRun, TestResult } from "../src/cli/storage/types.js";

// 10 test suites, each mapped to a source file path
const TEST_SUITES = [
  { suite: "tests/auth/test.spec.ts", srcDir: "src/auth" },
  { suite: "tests/users/test.spec.ts", srcDir: "src/users" },
  { suite: "tests/billing/test.spec.ts", srcDir: "src/billing" },
  { suite: "tests/dashboard/test.spec.ts", srcDir: "src/dashboard" },
  { suite: "tests/settings/test.spec.ts", srcDir: "src/settings" },
  { suite: "tests/search/test.spec.ts", srcDir: "src/search" },
  { suite: "tests/notifications/test.spec.ts", srcDir: "src/notifications" },
  { suite: "tests/reports/test.spec.ts", srcDir: "src/reports" },
  { suite: "tests/admin/test.spec.ts", srcDir: "src/admin" },
  { suite: "tests/api/test.spec.ts", srcDir: "src/api" },
];

// Indices of flaky tests (intermittent failures)
const FLAKY_INDICES = [0, 3]; // auth and dashboard

function seedData(store: DuckDBStore): Promise<void> {
  return seedRuns(store, 5);
}

async function seedRuns(store: DuckDBStore, runCount: number): Promise<void> {
  for (let runId = 1; runId <= runCount; runId++) {
    const run: WorkflowRun = {
      id: runId,
      repo: "local/local",
      branch: "main",
      commitSha: `sha-${runId}`,
      event: "push",
      status: "success",
      createdAt: new Date(Date.now() - (runCount - runId) * 86400000),
      durationMs: 60000,
    };
    await store.insertWorkflowRun(run);

    const results: TestResult[] = TEST_SUITES.map((t, idx) => {
      let status: string = "passed";

      // Flaky tests fail on even run IDs
      if (FLAKY_INDICES.includes(idx) && runId % 2 === 0) {
        status = "failed";
      }

      return {
        workflowRunId: runId,
        suite: t.suite,
        testName: "main test",
        status,
        durationMs: 1000 + idx * 100,
        retryCount: 0,
        errorMessage: status === "failed" ? "Intermittent failure" : null,
        commitSha: `sha-${runId}`,
        variant: null,
        createdAt: run.createdAt,
      };
    });

    await store.insertTestResults(results);
  }
}

describe("E2E: affected + actrun flow", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
    await seedData(store);
  });

  afterEach(async () => {
    await store.close();
  });

  it("hybrid sampling selects affected + flaky tests", async () => {
    const resolver = new SimpleResolver();
    const sampled = await runSample({
      store,
      mode: "hybrid",
      count: 5,
      resolver,
      changedFiles: ["src/auth/login.ts"],
      seed: 42,
    });

    const suites = sampled.map((s) => s.suite);

    // Should include affected test (auth matches src/auth/login.ts)
    expect(suites).toContain("tests/auth/test.spec.ts");

    // Should include previously failed tests (auth and dashboard are flaky)
    const hasFlaky = sampled.some(
      (s) => s.suite === "tests/dashboard/test.spec.ts",
    );
    expect(hasFlaky).toBe(true);

    // Should respect count limit
    expect(sampled.length).toBe(5);
  });

  it("affected mode returns only tests matching changed files", async () => {
    const resolver = new SimpleResolver();
    const sampled = await runSample({
      store,
      mode: "affected",
      resolver,
      changedFiles: ["src/auth/login.ts"],
    });

    expect(sampled.length).toBe(1);
    expect(sampled[0].suite).toBe("tests/auth/test.spec.ts");
  });

  it("hybrid sampling includes new tests in priority", async () => {
    // Add a brand-new test with only 1 run
    const newRun: WorkflowRun = {
      id: 100,
      repo: "local/local",
      branch: "main",
      commitSha: "sha-100",
      event: "push",
      status: "success",
      createdAt: new Date(),
      durationMs: 30000,
    };
    await store.insertWorkflowRun(newRun);
    await store.insertTestResults([
      {
        workflowRunId: 100,
        suite: "tests/new-feature/test.spec.ts",
        testName: "new test",
        status: "passed",
        durationMs: 500,
        retryCount: 0,
        errorMessage: null,
        commitSha: "sha-100",
        variant: null,
        createdAt: new Date(),
      },
    ]);

    const resolver = new SimpleResolver();
    const sampled = await runSample({
      store,
      mode: "hybrid",
      count: 5,
      resolver,
      changedFiles: ["src/auth/login.ts"],
      seed: 42,
    });

    const suites = sampled.map((s) => s.suite);
    // New test should be included (is_new = true, total_runs = 1)
    expect(suites).toContain("tests/new-feature/test.spec.ts");
  });

  it("eval shows correct health after data accumulation", async () => {
    const report = await runEval({ store });

    expect(report.healthScore).toBeGreaterThan(0);
    expect(report.dataSufficiency.uniqueTests).toBe(10);
    expect(report.dataSufficiency.totalRuns).toBe(5);
    expect(report.dataSufficiency.totalResults).toBe(50);
    // 2 flaky tests (auth and dashboard)
    expect(report.detection.flakyTests).toBeGreaterThan(0);
  });

  it("eval health score reflects stability", async () => {
    const report = await runEval({ store });

    // With 2/10 flaky tests, stability = 80%
    // coverage = min(avg_runs/10, 1.0) * 100 = min(5/10, 1) * 100 = 50
    // resolution = 100 (no resolved, but formula gives 100 when no flaky to resolve? Actually flakyTests > 0 so resolution = resolved/flaky * 100 = 0)
    // health = 80*0.5 + 50*0.3 + 0*0.2 = 40 + 15 + 0 = 55
    expect(report.healthScore).toBeGreaterThanOrEqual(40);
    expect(report.healthScore).toBeLessThanOrEqual(70);
  });

  it("importing more runs and re-evaluating shows updated metrics", async () => {
    // Add 5 more runs where flaky tests are now stable (all pass)
    for (let runId = 6; runId <= 10; runId++) {
      const run: WorkflowRun = {
        id: runId,
        repo: "local/local",
        branch: "main",
        commitSha: `sha-${runId}`,
        event: "push",
        status: "success",
        createdAt: new Date(Date.now() - (10 - runId) * 86400000),
        durationMs: 60000,
      };
      await store.insertWorkflowRun(run);

      const results: TestResult[] = TEST_SUITES.map((t, idx) => ({
        workflowRunId: runId,
        suite: t.suite,
        testName: "main test",
        status: "passed",
        durationMs: 1000 + idx * 100,
        retryCount: 0,
        errorMessage: null,
        commitSha: `sha-${runId}`,
        variant: null,
        createdAt: run.createdAt,
      }));

      await store.insertTestResults(results);
    }

    const report = await runEval({ store });
    expect(report.dataSufficiency.totalRuns).toBe(10);
    expect(report.dataSufficiency.totalResults).toBe(100);
    expect(report.dataSufficiency.avgRunsPerTest).toBe(10);
    // Health should be higher with more stable data
    expect(report.healthScore).toBeGreaterThan(50);
  });
});
