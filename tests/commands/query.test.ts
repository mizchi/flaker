import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { TestResult, WorkflowRun } from "../../src/cli/storage/types.js";
import { runQuery, formatQueryResult } from "../../src/cli/commands/analyze/query.js";

describe("query command", () => {
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

    const results: TestResult[] = [
      {
        workflowRunId: 1,
        suite: "suite-a",
        testName: "test-1",
        status: "passed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc123",
        variant: null,
        createdAt: new Date(),
      },
      {
        workflowRunId: 1,
        suite: "suite-a",
        testName: "test-2",
        status: "failed",
        durationMs: 200,
        retryCount: 0,
        errorMessage: "error",
        commitSha: "abc123",
        variant: null,
        createdAt: new Date(),
      },
    ];
    await store.insertTestResults(results);
  });

  afterEach(async () => {
    await store.close();
  });

  it("SELECT 42 AS answer", async () => {
    const rows = await runQuery(store, "SELECT 42 AS answer");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ answer: 42 });
  });

  it("COUNT from test_results", async () => {
    const rows = await runQuery(
      store,
      "SELECT COUNT(*)::INTEGER AS cnt FROM test_results",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ cnt: 2 });
  });

  it("formats query result as text table", () => {
    const rows = [
      { answer: 42, name: "hello" },
      { answer: 99, name: "world" },
    ];
    const table = formatQueryResult(rows);
    expect(table).toContain("answer");
    expect(table).toContain("name");
    expect(table).toContain("42");
    expect(table).toContain("hello");
    expect(table).toContain("99");
    expect(table).toContain("world");
  });
});
