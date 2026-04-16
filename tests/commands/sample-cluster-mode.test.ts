import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { planSample } from "../../src/cli/commands/exec/plan.js";

describe("cluster-aware sampling", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();

    for (let i = 1; i <= 5; i++) {
      await store.insertWorkflowRun({
        id: i,
        repo: "test/repo",
        branch: "main",
        commitSha: `sha${i}`,
        event: "push",
        status: "completed",
        createdAt: new Date(Date.now() - (6 - i) * 86400000),
        durationMs: 60000,
      });
    }

    for (const runId of [1, 2, 3]) {
      await store.insertTestResults([
        {
          workflowRunId: runId,
          suite: "tests/carousel-a.spec.ts",
          testName: "carousel A",
          status: "failed",
          durationMs: 100,
          retryCount: 0,
          errorMessage: "same root cause",
          commitSha: `sha${runId}`,
          variant: null,
          createdAt: new Date(Date.now() - (6 - runId) * 86400000),
        },
        {
          workflowRunId: runId,
          suite: "tests/carousel-b.spec.ts",
          testName: "carousel B",
          status: "failed",
          durationMs: 100,
          retryCount: 0,
          errorMessage: "same root cause",
          commitSha: `sha${runId}`,
          variant: null,
          createdAt: new Date(Date.now() - (6 - runId) * 86400000),
        },
        {
          workflowRunId: runId,
          suite: "tests/cms-a.spec.ts",
          testName: "cms A",
          status: "passed",
          durationMs: 100,
          retryCount: 0,
          errorMessage: null,
          commitSha: `sha${runId}`,
          variant: null,
          createdAt: new Date(Date.now() - (6 - runId) * 86400000),
        },
        {
          workflowRunId: runId,
          suite: "tests/cms-b.spec.ts",
          testName: "cms B",
          status: "passed",
          durationMs: 100,
          retryCount: 0,
          errorMessage: null,
          commitSha: `sha${runId}`,
          variant: null,
          createdAt: new Date(Date.now() - (6 - runId) * 86400000),
        },
      ]);
    }

    for (const runId of [4, 5]) {
      await store.insertTestResults([
        {
          workflowRunId: runId,
          suite: "tests/carousel-a.spec.ts",
          testName: "carousel A",
          status: "passed",
          durationMs: 100,
          retryCount: 0,
          errorMessage: null,
          commitSha: `sha${runId}`,
          variant: null,
          createdAt: new Date(Date.now() - (6 - runId) * 86400000),
        },
        {
          workflowRunId: runId,
          suite: "tests/carousel-b.spec.ts",
          testName: "carousel B",
          status: "passed",
          durationMs: 100,
          retryCount: 0,
          errorMessage: null,
          commitSha: `sha${runId}`,
          variant: null,
          createdAt: new Date(Date.now() - (6 - runId) * 86400000),
        },
        {
          workflowRunId: runId,
          suite: "tests/cms-a.spec.ts",
          testName: "cms A",
          status: "failed",
          durationMs: 100,
          retryCount: 0,
          errorMessage: "same root cause",
          commitSha: `sha${runId}`,
          variant: null,
          createdAt: new Date(Date.now() - (6 - runId) * 86400000),
        },
        {
          workflowRunId: runId,
          suite: "tests/cms-b.spec.ts",
          testName: "cms B",
          status: "failed",
          durationMs: 100,
          retryCount: 0,
          errorMessage: "same root cause",
          commitSha: `sha${runId}`,
          variant: null,
          createdAt: new Date(Date.now() - (6 - runId) * 86400000),
        },
      ]);
    }
  });

  afterEach(async () => {
    await store.close();
  });

  it("spread mode samples one representative from each cluster first", async () => {
    const plan = await planSample({
      store,
      count: 2,
      mode: "weighted",
      seed: 42,
      clusterMode: "spread",
    });

    expect(plan.sampled).toHaveLength(2);
    const suites = plan.sampled.map((test) => test.suite);
    expect(suites.some((suite) => suite.startsWith("tests/carousel-"))).toBe(true);
    expect(suites.some((suite) => suite.startsWith("tests/cms-"))).toBe(true);
  });

  it("pack mode keeps sampling within the same strongest cluster", async () => {
    const plan = await planSample({
      store,
      count: 2,
      mode: "weighted",
      seed: 42,
      clusterMode: "pack",
    });

    expect(plan.sampled).toHaveLength(2);
    expect(plan.sampled.map((test) => test.suite)).toEqual(
      expect.arrayContaining([
        "tests/carousel-a.spec.ts",
        "tests/carousel-b.spec.ts",
      ]),
    );
  });
});
