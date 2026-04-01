import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runFlakyByVariant } from "../../src/cli/commands/flaky.js";

describe("flaky by variant", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();

    // Seed a workflow run
    await store.insertWorkflowRun({
      id: 1, repo: "test/repo", branch: "main", commitSha: "abc123",
      event: "push", status: "completed",
      createdAt: new Date(2026, 2, 1), durationMs: 60000,
    });

    // Chromium variant: 3/10 fail = 30%
    for (let i = 0; i < 10; i++) {
      await store.insertTestResults([{
        workflowRunId: 1, suite: "tests/login.spec.ts", testName: "should login",
        status: i < 3 ? "failed" : "passed",
        durationMs: 100, retryCount: 0,
        errorMessage: i < 3 ? "Timeout" : null,
        commitSha: "abc123",
        variant: { browser: "chromium" },
        createdAt: new Date(2026, 2, 1),
      }]);
    }

    // Firefox variant: 1/10 fail = 10%
    for (let i = 0; i < 10; i++) {
      await store.insertTestResults([{
        workflowRunId: 1, suite: "tests/login.spec.ts", testName: "should login",
        status: i < 1 ? "failed" : "passed",
        durationMs: 100, retryCount: 0,
        errorMessage: i < 1 ? "Timeout" : null,
        commitSha: "abc123",
        variant: { browser: "firefox" },
        createdAt: new Date(2026, 2, 1),
      }]);
    }

    // No-variant rows should be excluded
    for (let i = 0; i < 5; i++) {
      await store.insertTestResults([{
        workflowRunId: 1, suite: "tests/login.spec.ts", testName: "should login",
        status: "passed",
        durationMs: 100, retryCount: 0, errorMessage: null,
        commitSha: "abc123",
        variant: null,
        createdAt: new Date(2026, 2, 1),
      }]);
    }
  });

  afterEach(async () => { await store.close(); });

  it("returns variant-specific flaky rates", async () => {
    const results = await runFlakyByVariant({ store });
    expect(results).toHaveLength(2);

    const chromium = results.find((r) => r.variant.browser === "chromium");
    const firefox = results.find((r) => r.variant.browser === "firefox");

    expect(chromium).toBeDefined();
    expect(chromium!.totalRuns).toBe(10);
    expect(chromium!.failCount).toBe(3);
    expect(chromium!.flakyRate).toBe(30);

    expect(firefox).toBeDefined();
    expect(firefox!.totalRuns).toBe(10);
    expect(firefox!.failCount).toBe(1);
    expect(firefox!.flakyRate).toBe(10);
  });

  it("filters by suite", async () => {
    const results = await runFlakyByVariant({ store, suite: "tests/login.spec.ts" });
    expect(results).toHaveLength(2);

    const none = await runFlakyByVariant({ store, suite: "nonexistent" });
    expect(none).toHaveLength(0);
  });

  it("respects top limit", async () => {
    const results = await runFlakyByVariant({ store, top: 1 });
    expect(results).toHaveLength(1);
    // Should be the highest flaky rate (chromium at 30%)
    expect(results[0].flakyRate).toBe(30);
  });
});
