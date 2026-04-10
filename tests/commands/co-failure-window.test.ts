import { describe, it, expect } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { analyzeCoFailureWindows, formatCoFailureWindowReport } from "../../src/cli/commands/dev/eval-co-failure.js";

async function createStoreWithData() {
  const store = new DuckDBStore(":memory:");
  await store.initialize();

  const now = Date.now();
  const day = 86400000;

  // Create workflow runs with different commit dates
  for (let i = 1; i <= 5; i++) {
    await store.insertWorkflowRun({
      id: i,
      repo: "test/repo",
      branch: "main",
      commitSha: `sha${i}`,
      event: "push",
      status: "completed",
      createdAt: new Date(now - (6 - i) * day * 10),
      durationMs: 60000,
    });
  }

  // Recent commits: co-failure between src/auth.ts and login test
  await store.insertCommitChanges("sha1", [
    { filePath: "src/auth.ts", changeType: "modified", additions: 5, deletions: 2 },
  ]);
  await store.insertTestResults([
    {
      workflowRunId: 1, suite: "auth.test.ts", testName: "login",
      status: "failed", durationMs: 100, retryCount: 0, errorMessage: "err",
      commitSha: "sha1", variant: null, createdAt: new Date(now - day),
    },
  ]);

  await store.insertCommitChanges("sha2", [
    { filePath: "src/auth.ts", changeType: "modified", additions: 3, deletions: 1 },
  ]);
  await store.insertTestResults([
    {
      workflowRunId: 2, suite: "auth.test.ts", testName: "login",
      status: "passed", durationMs: 100, retryCount: 1, errorMessage: null,
      commitSha: "sha2", variant: null, createdAt: new Date(now - day * 10),
    },
  ]);

  await store.insertCommitChanges("sha3", [
    { filePath: "src/utils.ts", changeType: "modified", additions: 1, deletions: 0 },
  ]);
  await store.insertTestResults([
    {
      workflowRunId: 3, suite: "auth.test.ts", testName: "login",
      status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
      commitSha: "sha3", variant: null, createdAt: new Date(now - day * 20),
    },
  ]);

  await store.insertCommitChanges("sha4", [
    { filePath: "src/auth.ts", changeType: "modified", additions: 10, deletions: 5 },
  ]);
  await store.insertTestResults([
    {
      workflowRunId: 4, suite: "auth.test.ts", testName: "login",
      status: "failed", durationMs: 100, retryCount: 0, errorMessage: "err",
      commitSha: "sha4", variant: null, createdAt: new Date(now - day * 50),
    },
  ]);

  await store.insertCommitChanges("sha5", [
    { filePath: "src/api.ts", changeType: "modified", additions: 2, deletions: 1 },
  ]);
  await store.insertTestResults([
    {
      workflowRunId: 5, suite: "auth.test.ts", testName: "login",
      status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
      commitSha: "sha5", variant: null, createdAt: new Date(now - day * 100),
    },
  ]);

  return store;
}

describe("analyzeCoFailureWindows", () => {
  it("returns analysis for multiple windows", async () => {
    const store = await createStoreWithData();
    try {
      const report = await analyzeCoFailureWindows(store, [7, 30, 90, 180], 1);

      expect(report.windows.length).toBe(4);
      expect(report.recommended).toBeGreaterThan(0);
      expect(report.reasoning).toBeTruthy();

      // Longer windows should generally have more data points
      const w30 = report.windows.find((w) => w.windowDays === 30);
      const w180 = report.windows.find((w) => w.windowDays === 180);
      expect(w30).toBeDefined();
      expect(w180).toBeDefined();
    } finally {
      await store.close();
    }
  });

  it("handles empty database", async () => {
    const store = new DuckDBStore(":memory:");
    await store.initialize();

    try {
      const report = await analyzeCoFailureWindows(store, [7, 30], 3);
      expect(report.windows.every((w) => w.dataPoints === 0)).toBe(true);
      expect(report.reasoning).toContain("データ不足");
    } finally {
      await store.close();
    }
  });
});

describe("formatCoFailureWindowReport", () => {
  it("formats report as readable table", () => {
    const report = {
      windows: [
        { windowDays: 7, dataPoints: 5, avgRate: 20, maxRate: 50, minRate: 10, medianRate: 15, strength: 0.2 },
        { windowDays: 30, dataPoints: 20, avgRate: 25, maxRate: 60, minRate: 5, medianRate: 22, strength: 0.5 },
      ],
      recommended: 30,
      reasoning: "中期窓が最適",
    };

    const output = formatCoFailureWindowReport(report);
    expect(output).toContain("# Co-failure Window Sensitivity Analysis");
    expect(output).toContain("30");
    expect(output).toContain("★");
    expect(output).toContain("--co-failure-days 30");
  });
});
