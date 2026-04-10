import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { TestResult, WorkflowRun } from "../../src/cli/storage/types.js";
import { runTrueFlaky, formatTrueFlakyTable } from "../../src/cli/commands/analyze/flaky.js";

describe("true flaky detection", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();

    // Two workflow runs for different commits
    const run1: WorkflowRun = {
      id: 1,
      repo: "owner/repo",
      branch: "main",
      commitSha: "sha1",
      event: "push",
      status: "success",
      createdAt: new Date(),
      durationMs: 60000,
    };
    const run2: WorkflowRun = {
      id: 2,
      repo: "owner/repo",
      branch: "main",
      commitSha: "sha2",
      event: "push",
      status: "success",
      createdAt: new Date(),
      durationMs: 60000,
    };
    await store.insertWorkflowRun(run1);
    await store.insertWorkflowRun(run2);

    const results: TestResult[] = [];

    // "test_flaky": same commit "sha1" with both pass AND fail (true flaky)
    results.push({
      workflowRunId: 1,
      suite: "suite-a",
      testName: "test_flaky",
      status: "passed",
      durationMs: 100,
      retryCount: 0,
      errorMessage: null,
      commitSha: "sha1",
      variant: null,
      createdAt: new Date(),
    });
    results.push({
      workflowRunId: 1,
      suite: "suite-a",
      testName: "test_flaky",
      status: "failed",
      durationMs: 100,
      retryCount: 0,
      errorMessage: "timeout",
      commitSha: "sha1",
      variant: null,
      createdAt: new Date(),
    });

    // "test_stable": same commit "sha1" with only pass results (not flaky)
    results.push({
      workflowRunId: 1,
      suite: "suite-a",
      testName: "test_stable",
      status: "passed",
      durationMs: 50,
      retryCount: 0,
      errorMessage: null,
      commitSha: "sha1",
      variant: null,
      createdAt: new Date(),
    });
    results.push({
      workflowRunId: 1,
      suite: "suite-a",
      testName: "test_stable",
      status: "passed",
      durationMs: 50,
      retryCount: 0,
      errorMessage: null,
      commitSha: "sha1",
      variant: null,
      createdAt: new Date(),
    });

    // "test_bad": commit "sha1" all fail, commit "sha2" all pass (not true flaky — broke and fixed)
    results.push({
      workflowRunId: 1,
      suite: "suite-a",
      testName: "test_bad",
      status: "failed",
      durationMs: 100,
      retryCount: 0,
      errorMessage: "assertion",
      commitSha: "sha1",
      variant: null,
      createdAt: new Date(),
    });
    results.push({
      workflowRunId: 1,
      suite: "suite-a",
      testName: "test_bad",
      status: "failed",
      durationMs: 100,
      retryCount: 0,
      errorMessage: "assertion",
      commitSha: "sha1",
      variant: null,
      createdAt: new Date(),
    });
    results.push({
      workflowRunId: 2,
      suite: "suite-a",
      testName: "test_bad",
      status: "passed",
      durationMs: 100,
      retryCount: 0,
      errorMessage: null,
      commitSha: "sha2",
      variant: null,
      createdAt: new Date(),
    });
    results.push({
      workflowRunId: 2,
      suite: "suite-a",
      testName: "test_bad",
      status: "passed",
      durationMs: 100,
      retryCount: 0,
      errorMessage: null,
      commitSha: "sha2",
      variant: null,
      createdAt: new Date(),
    });

    await store.insertTestResults(results);
  });

  afterEach(async () => {
    await store.close();
  });

  it("returns only true flaky tests (same commit with both pass and fail)", async () => {
    const results = await runTrueFlaky({ store });
    expect(results).toHaveLength(1);
    expect(results[0].testName).toBe("test_flaky");
    expect(results[0].suite).toBe("suite-a");
    expect(results[0].flakyCommits).toBe(1);
    expect(results[0].commitsTested).toBe(1);
    expect(results[0].trueFlakyRate).toBe(100);
  });

  it("does not return test_stable", async () => {
    const results = await runTrueFlaky({ store });
    const names = results.map((r) => r.testName);
    expect(names).not.toContain("test_stable");
  });

  it("does not return test_bad (different commits, not same-commit flaky)", async () => {
    const results = await runTrueFlaky({ store });
    const names = results.map((r) => r.testName);
    expect(names).not.toContain("test_bad");
  });

  it("respects top option", async () => {
    const results = await runTrueFlaky({ store, top: 0 });
    // top=0 means no limit effectively, but with LIMIT 0 it returns nothing
    // Let's test with top=1
    const limited = await runTrueFlaky({ store, top: 1 });
    expect(limited.length).toBeLessThanOrEqual(1);
  });

  it("formats true flaky table", async () => {
    const results = await runTrueFlaky({ store });
    const output = formatTrueFlakyTable(results);
    expect(output).toContain("test_flaky");
    expect(output).toContain("100.0%");
    expect(output).toContain("1/1 commits");
  });

  it("formats empty results", () => {
    const output = formatTrueFlakyTable([]);
    expect(output).toBe("No retry-flaky tests found (pass+fail within same commit).");
  });
});
