import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { TestResult, WorkflowRun } from "../../src/cli/storage/types.js";
import { runFlaky, formatFlakyTable } from "../../src/cli/commands/analyze/flaky.js";

describe("flaky command", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();

    // Insert a workflow run
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

    // Seed 10 results for "flakyTest": 5 failed, 5 passed
    const flakyResults: TestResult[] = [];
    for (let i = 0; i < 10; i++) {
      flakyResults.push({
        workflowRunId: 1,
        suite: "suite-a",
        testName: "flakyTest",
        status: i < 5 ? "failed" : "passed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: i < 5 ? "timeout" : null,
        commitSha: "abc123",
        variant: null,
        createdAt: new Date(),
      });
    }

    // Seed 10 all-passed results for "stableTest"
    for (let i = 0; i < 10; i++) {
      flakyResults.push({
        workflowRunId: 1,
        suite: "suite-a",
        testName: "stableTest",
        status: "passed",
        durationMs: 50,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc123",
        variant: null,
        createdAt: new Date(),
      });
    }

    await store.insertTestResults(flakyResults);
  });

  afterEach(async () => {
    await store.close();
  });

  it("returns only flaky tests", async () => {
    const results = await runFlaky({ store });
    expect(results).toHaveLength(1);
    expect(results[0].testName).toBe("flakyTest");
    expect(results[0].flakyRate).toBe(50);
  });

  it("filters by test name", async () => {
    const results = await runFlaky({ store, testName: "stableTest" });
    expect(results).toHaveLength(0);

    const flakyResults = await runFlaky({ store, testName: "flakyTest" });
    expect(flakyResults).toHaveLength(1);
    expect(flakyResults[0].testName).toBe("flakyTest");
  });

  it("formats as text table", async () => {
    const results = await runFlaky({ store });
    const table = formatFlakyTable(results);
    expect(table).toContain("flakyTest");
    expect(table).toContain("suite-a");
    expect(table).toContain("50");
    expect(table).not.toContain("stableTest");
  });
});
