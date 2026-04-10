import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { TestResult, WorkflowRun } from "../../src/cli/storage/types.js";
import { runFlakyTrend, formatFlakyTrend } from "../../src/cli/commands/analyze/flaky.js";

describe("flaky trend", () => {
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

    // Week 1: 4 failed out of 5 = 80% flaky
    const week1Base = new Date("2025-01-06T12:00:00Z"); // Monday
    const results: TestResult[] = [];
    for (let i = 0; i < 5; i++) {
      results.push({
        workflowRunId: 1,
        suite: "suite-a",
        testName: "flakyTest",
        status: i < 4 ? "failed" : "passed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: i < 4 ? "timeout" : null,
        commitSha: "abc123",
        variant: null,
        createdAt: new Date(week1Base.getTime() + i * 3600000),
      });
    }

    // Week 2: 1 failed out of 5 = 20% flaky
    const week2Base = new Date("2025-01-13T12:00:00Z"); // Next Monday
    for (let i = 0; i < 5; i++) {
      results.push({
        workflowRunId: 1,
        suite: "suite-a",
        testName: "flakyTest",
        status: i < 1 ? "failed" : "passed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: i < 1 ? "timeout" : null,
        commitSha: "abc123",
        variant: null,
        createdAt: new Date(week2Base.getTime() + i * 3600000),
      });
    }

    await store.insertTestResults(results);
  });

  afterEach(async () => {
    await store.close();
  });

  it("returns trend data across 2 weeks with decreasing flaky rate", async () => {
    const entries = await runFlakyTrend({ store, suite: "suite-a", testName: "flakyTest" });
    expect(entries).toHaveLength(2);
    expect(entries[0].runs).toBe(5);
    expect(entries[0].flakyRate).toBe(80);
    expect(entries[1].runs).toBe(5);
    expect(entries[1].flakyRate).toBe(20);
    // Decreasing trend
    expect(entries[1].flakyRate).toBeLessThan(entries[0].flakyRate);
  });

  it("formats trend entries as text", () => {
    const entries = [
      { suite: "suite-a", testName: "flakyTest", week: "2025-01-06", runs: 5, flakyRate: 80 },
      { suite: "suite-a", testName: "flakyTest", week: "2025-01-13", runs: 5, flakyRate: 20 },
    ];
    const text = formatFlakyTrend(entries);
    expect(text).toContain("80.0%");
    expect(text).toContain("20.0%");
    expect(text).toContain("5 runs");
  });

  it("returns empty message when no data", () => {
    const text = formatFlakyTrend([]);
    expect(text).toBe("No trend data found.");
  });
});
