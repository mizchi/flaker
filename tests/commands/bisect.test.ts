import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { TestResult, WorkflowRun } from "../../src/cli/storage/types.js";
import { runBisect } from "../../src/cli/commands/debug/bisect.js";

describe("bisect command", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();

    const run: WorkflowRun = {
      id: 1,
      repo: "owner/repo",
      branch: "main",
      commitSha: "sha1",
      event: "push",
      status: "success",
      createdAt: new Date(),
      durationMs: 60000,
    };
    await store.insertWorkflowRun(run);
  });

  afterEach(async () => {
    await store.close();
  });

  it("finds transition from good to bad commit", async () => {
    const results: TestResult[] = [
      // sha1: all pass
      { workflowRunId: 1, suite: "s", testName: "t", status: "passed", durationMs: 10, retryCount: 0, errorMessage: null, commitSha: "sha1", variant: null, createdAt: new Date("2025-01-01T10:00:00Z") },
      { workflowRunId: 1, suite: "s", testName: "t", status: "passed", durationMs: 10, retryCount: 0, errorMessage: null, commitSha: "sha1", variant: null, createdAt: new Date("2025-01-01T11:00:00Z") },
      // sha2: all pass
      { workflowRunId: 1, suite: "s", testName: "t", status: "passed", durationMs: 10, retryCount: 0, errorMessage: null, commitSha: "sha2", variant: null, createdAt: new Date("2025-01-02T10:00:00Z") },
      // sha3: has failure
      { workflowRunId: 1, suite: "s", testName: "t", status: "failed", durationMs: 10, retryCount: 0, errorMessage: "err", commitSha: "sha3", variant: null, createdAt: new Date("2025-01-03T10:00:00Z") },
      { workflowRunId: 1, suite: "s", testName: "t", status: "passed", durationMs: 10, retryCount: 0, errorMessage: null, commitSha: "sha3", variant: null, createdAt: new Date("2025-01-03T11:00:00Z") },
    ];
    await store.insertTestResults(results);

    const result = await runBisect({ store, suite: "s", testName: "t" });
    expect(result).not.toBeNull();
    expect(result!.lastGoodCommit).toBe("sha2");
    expect(result!.firstBadCommit).toBe("sha3");
  });

  it("returns null when always failed", async () => {
    const results: TestResult[] = [
      { workflowRunId: 1, suite: "s", testName: "t", status: "failed", durationMs: 10, retryCount: 0, errorMessage: "err", commitSha: "sha1", variant: null, createdAt: new Date("2025-01-01T10:00:00Z") },
      { workflowRunId: 1, suite: "s", testName: "t", status: "failed", durationMs: 10, retryCount: 0, errorMessage: "err", commitSha: "sha2", variant: null, createdAt: new Date("2025-01-02T10:00:00Z") },
    ];
    await store.insertTestResults(results);

    const result = await runBisect({ store, suite: "s", testName: "t" });
    expect(result).toBeNull();
  });

  it("returns null when never failed", async () => {
    const results: TestResult[] = [
      { workflowRunId: 1, suite: "s", testName: "t", status: "passed", durationMs: 10, retryCount: 0, errorMessage: null, commitSha: "sha1", variant: null, createdAt: new Date("2025-01-01T10:00:00Z") },
      { workflowRunId: 1, suite: "s", testName: "t", status: "passed", durationMs: 10, retryCount: 0, errorMessage: null, commitSha: "sha2", variant: null, createdAt: new Date("2025-01-02T10:00:00Z") },
    ];
    await store.insertTestResults(results);

    const result = await runBisect({ store, suite: "s", testName: "t" });
    expect(result).toBeNull();
  });
});
