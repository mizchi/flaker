import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { TestResult, WorkflowRun } from "../../src/cli/storage/types.js";
import { planSample } from "../../src/cli/commands/exec/plan.js";

describe("holdout sampling", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();

    const run: WorkflowRun = {
      id: 1,
      repo: "owner/repo",
      branch: "main",
      commitSha: "abc123",
      event: "push",
      status: "success",
      createdAt: new Date(),
      durationMs: 60000,
    };
    await store.insertWorkflowRun(run);

    const results: TestResult[] = [];
    for (let i = 0; i < 20; i++) {
      results.push({
        workflowRunId: 1,
        suite: "suite-a",
        testName: `test-${i}`,
        status: i < 3 ? "failed" : "passed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc123",
        variant: null,
        createdAt: new Date(),
      });
    }
    await store.insertTestResults(results);
  });

  afterEach(async () => {
    await store.close();
  });

  it("returns empty holdout when holdoutRatio is 0", async () => {
    const plan = await planSample({
      store,
      count: 5,
      mode: "weighted",
      seed: 42,
      holdoutRatio: 0,
    });
    expect(plan.holdout).toHaveLength(0);
    expect(plan.summary.holdoutCount).toBe(0);
  });

  it("selects holdout tests from skipped tests", async () => {
    const plan = await planSample({
      store,
      count: 5,
      mode: "weighted",
      seed: 42,
      holdoutRatio: 0.2,
    });
    // 20 tests, 5 sampled, 15 skipped, 20% of 15 = 3
    expect(plan.holdout).toHaveLength(3);
    expect(plan.summary.holdoutCount).toBe(3);

    // Holdout tests should not overlap with sampled tests
    const sampledSuites = new Set(plan.sampled.map((t) => `${t.suite}::${t.test_name}`));
    for (const h of plan.holdout) {
      expect(sampledSuites.has(`${h.suite}::${h.test_name}`)).toBe(false);
    }
  });

  it("holdout is deterministic with same seed", async () => {
    const plan1 = await planSample({
      store,
      count: 5,
      mode: "weighted",
      seed: 42,
      holdoutRatio: 0.2,
    });
    const plan2 = await planSample({
      store,
      count: 5,
      mode: "weighted",
      seed: 42,
      holdoutRatio: 0.2,
    });
    expect(plan1.holdout.map((t) => t.test_name)).toEqual(
      plan2.holdout.map((t) => t.test_name),
    );
  });

  it("returns empty holdout when all tests are sampled", async () => {
    const plan = await planSample({
      store,
      count: 20,
      mode: "weighted",
      seed: 42,
      holdoutRatio: 0.5,
    });
    expect(plan.holdout).toHaveLength(0);
  });
});
