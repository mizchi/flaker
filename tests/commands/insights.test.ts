import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runInsights, formatInsights } from "../../src/cli/commands/analyze/insights.js";

describe("insights", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("returns empty result with no data", async () => {
    const result = await runInsights({ store });
    expect(result.summary.totalTests).toBe(0);
    expect(result.localOnly).toHaveLength(0);
    expect(result.ciOnly).toHaveLength(0);
    expect(result.both).toHaveLength(0);
  });

  it("classifies local-only failures", async () => {
    // CI run — test passes
    await store.insertWorkflowRun({
      id: 1, repo: "test/repo", branch: "main", commitSha: "sha1",
      event: "push", source: "ci", status: "success",
      createdAt: new Date(), durationMs: 100,
    });
    await store.insertTestResults([{
      workflowRunId: 1, suite: "a.test.ts", testName: "test1",
      status: "passed", commitSha: "sha1", durationMs: 10,
      retryCount: 0, errorMessage: null, variant: null,
      createdAt: new Date(),
    }]);

    // Local run — same test fails
    await store.insertWorkflowRun({
      id: 2, repo: "test/repo", branch: "local", commitSha: "sha2",
      event: "flaker-local-run", source: "local", status: "failure",
      createdAt: new Date(), durationMs: 100,
    });
    await store.insertTestResults([{
      workflowRunId: 2, suite: "a.test.ts", testName: "test1",
      status: "failed", commitSha: "sha2", durationMs: 10,
      retryCount: 0, errorMessage: null, variant: null,
      createdAt: new Date(),
    }]);

    const result = await runInsights({ store });
    expect(result.summary.localOnlyCount).toBe(1);
    expect(result.localOnly).toHaveLength(1);
    expect(result.localOnly[0].suite).toBe("a.test.ts");
    expect(result.localOnly[0].localFails).toBe(1);
    expect(result.localOnly[0].ciFails).toBe(0);
  });

  it("classifies both-source failures", async () => {
    await store.insertWorkflowRun({
      id: 1, repo: "test/repo", branch: "main", commitSha: "sha1",
      event: "push", source: "ci", status: "failure",
      createdAt: new Date(), durationMs: 100,
    });
    await store.insertTestResults([{
      workflowRunId: 1, suite: "b.test.ts", testName: "flaky",
      status: "failed", commitSha: "sha1", durationMs: 10,
      retryCount: 0, errorMessage: null, variant: null,
      createdAt: new Date(),
    }]);

    await store.insertWorkflowRun({
      id: 2, repo: "test/repo", branch: "local", commitSha: "sha2",
      event: "flaker-local-run", source: "local", status: "failure",
      createdAt: new Date(), durationMs: 100,
    });
    await store.insertTestResults([{
      workflowRunId: 2, suite: "b.test.ts", testName: "flaky",
      status: "failed", commitSha: "sha2", durationMs: 10,
      retryCount: 0, errorMessage: null, variant: null,
      createdAt: new Date(),
    }]);

    const result = await runInsights({ store });
    expect(result.summary.bothCount).toBe(1);
    expect(result.both).toHaveLength(1);
    expect(result.both[0].ciFails).toBe(1);
    expect(result.both[0].localFails).toBe(1);
  });

  it("formats report with sections", async () => {
    const result = await runInsights({ store });
    const report = formatInsights(result);
    expect(report).toContain("CI vs Local Failure Insights");
    expect(report).toContain("Run more tests locally");
  });
});
