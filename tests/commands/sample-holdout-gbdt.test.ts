import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { TestResult, WorkflowRun } from "../../src/cli/storage/types.js";
import { planSample } from "../../src/cli/commands/exec/plan.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadCore } from "../../src/cli/core/loader.js";
import { FLAKER_FEATURE_NAMES } from "../../src/cli/eval/gbdt.js";

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
      mode: "random",
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
      mode: "random",
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
      mode: "random",
      seed: 42,
      holdoutRatio: 0.2,
    });
    const plan2 = await planSample({
      store,
      count: 5,
      mode: "random",
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
      mode: "random",
      seed: 42,
      holdoutRatio: 0.5,
    });
    expect(plan.holdout).toHaveLength(0);
  });
});

describe("gbdt sampling strategy", () => {
  let store: DuckDBStore;
  let modelDir: string;

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
    // 3 flaky tests with high fail rate
    for (let i = 0; i < 3; i++) {
      for (let r = 0; r < 5; r++) {
        results.push({
          workflowRunId: 1,
          suite: "suite-a",
          testName: `flaky-${i}`,
          status: r < 3 ? "failed" : "passed",
          durationMs: 200,
          retryCount: 0,
          errorMessage: r < 3 ? "error" : null,
          commitSha: "abc123",
          variant: null,
          createdAt: new Date(),
        });
      }
    }
    // 10 stable tests
    for (let i = 0; i < 10; i++) {
      for (let r = 0; r < 5; r++) {
        results.push({
          workflowRunId: 1,
          suite: "suite-a",
          testName: `stable-${i}`,
          status: "passed",
          durationMs: 50,
          retryCount: 0,
          errorMessage: null,
          commitSha: "abc123",
          variant: null,
          createdAt: new Date(),
        });
      }
    }
    await store.insertTestResults(results);

    // Train and save a model
    const core = await loadCore();
    const trainingData = [
      // Flaky patterns
      ...Array.from({ length: 30 }, () => ({
        features: [60, 0, 5, 3, 200, 1, 0],
        label: 1,
      })),
      // Stable patterns
      ...Array.from({ length: 70 }, () => ({
        features: [0, 0, 5, 0, 50, 0, 0],
        label: 0,
      })),
    ];
    const model = core.trainGBDT(trainingData, 10, 0.2);

    modelDir = resolve(tmpdir(), `flaker-test-gbdt-${Date.now()}`);
    mkdirSync(modelDir, { recursive: true });
    writeFileSync(
      resolve(modelDir, "gbdt.json"),
      JSON.stringify({
        ...model as Record<string, unknown>,
        featureNames: FLAKER_FEATURE_NAMES,
        feature_names: FLAKER_FEATURE_NAMES,
      }),
    );
  });

  afterEach(async () => {
    await store.close();
    rmSync(modelDir, { recursive: true, force: true });
  });

  it("gbdt strategy selects tests ranked by predicted failure probability", async () => {
    const plan = await planSample({
      store,
      count: 5,
      mode: "gbdt",
      seed: 42,
      modelPath: resolve(modelDir, "gbdt.json"),
    });

    expect(plan.sampled).toHaveLength(5);
    // Flaky tests should be ranked higher
    const flakySelected = plan.sampled.filter((t) =>
      t.test_name.startsWith("flaky-"),
    );
    expect(flakySelected.length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to weighted when model not found", async () => {
    const plan = await planSample({
      store,
      count: 5,
      mode: "gbdt",
      seed: 42,
      modelPath: "/nonexistent/model.json",
    });

    expect(plan.sampled).toHaveLength(5);
    // Should fall back to weighted
    expect(plan.summary.strategy).toBe("weighted");
  });
});
