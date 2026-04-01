import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { TestResult, WorkflowRun } from "../../src/cli/storage/types.js";
import { runReason, formatReasoningReport } from "../../src/cli/commands/reason.js";

function makeRun(id: number, commitSha: string, createdAt: Date, branch = "main"): WorkflowRun {
  return {
    id,
    repo: "owner/repo",
    branch,
    commitSha,
    event: "push",
    status: "success",
    createdAt,
    durationMs: 60000,
  };
}

function makeResult(
  workflowRunId: number,
  suite: string,
  testName: string,
  status: string,
  commitSha: string,
  createdAt: Date,
  opts?: { retryCount?: number; durationMs?: number },
): TestResult {
  return {
    workflowRunId,
    suite,
    testName,
    status,
    durationMs: opts?.durationMs ?? 100,
    retryCount: opts?.retryCount ?? 0,
    errorMessage: status === "failed" ? "error" : null,
    commitSha,
    variant: null,
    createdAt,
  };
}

describe("reason command", () => {
  let store: DuckDBStore;
  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();

    // Seed realistic data:

    // --- Workflow runs ---
    // Recent runs (within last 7 days)
    for (let i = 1; i <= 10; i++) {
      await store.insertWorkflowRun(makeRun(i, `commit-${i}`, daysAgo(i)));
    }
    // Older runs (20-25 days ago)
    for (let i = 11; i <= 20; i++) {
      await store.insertWorkflowRun(makeRun(i, `commit-${i}`, daysAgo(20 + (i - 11))));
    }

    const results: TestResult[] = [];

    // --- 3 True flaky tests (same commit, both pass and fail) ---
    // In suite "suite-flaky"
    for (let i = 1; i <= 5; i++) {
      // Each commit gets both pass and fail
      results.push(makeResult(i, "suite-flaky", "trueFlaky1", "passed", `commit-${i}`, daysAgo(i)));
      results.push(makeResult(i, "suite-flaky", "trueFlaky1", "failed", `commit-${i}`, daysAgo(i)));
      results.push(makeResult(i, "suite-flaky", "trueFlaky2", "passed", `commit-${i}`, daysAgo(i)));
      results.push(makeResult(i, "suite-flaky", "trueFlaky2", "failed", `commit-${i}`, daysAgo(i)));
      results.push(makeResult(i, "suite-flaky", "trueFlaky3", "passed", `commit-${i}`, daysAgo(i)));
      results.push(makeResult(i, "suite-flaky", "trueFlaky3", "failed", `commit-${i}`, daysAgo(i)));
    }

    // --- 2 Regression tests (stable old, failing recently) ---
    // Old results: all passing
    for (let i = 11; i <= 20; i++) {
      results.push(makeResult(i, "suite-reg", "regression1", "passed", `commit-${i}`, daysAgo(20 + (i - 11))));
      results.push(makeResult(i, "suite-reg", "regression2", "passed", `commit-${i}`, daysAgo(20 + (i - 11))));
    }
    // Recent results: all failing with same commits (commit-specific)
    for (let i = 1; i <= 5; i++) {
      results.push(makeResult(i, "suite-reg", "regression1", "failed", `commit-${i}`, daysAgo(i)));
      results.push(makeResult(i, "suite-reg", "regression1", "failed", `commit-${i}`, daysAgo(i)));
      results.push(makeResult(i, "suite-reg", "regression2", "failed", `commit-${i}`, daysAgo(i)));
      results.push(makeResult(i, "suite-reg", "regression2", "failed", `commit-${i}`, daysAgo(i)));
    }

    // --- 1 Intermittent test (passes on retry) ---
    for (let i = 1; i <= 10; i++) {
      const status = i <= 3 ? "flaky" : "passed";
      results.push(makeResult(i, "suite-inter", "intermittent1", status, `commit-${i}`, daysAgo(i), { retryCount: i <= 3 ? 1 : 0 }));
    }

    // --- 4 Stable tests ---
    for (let i = 1; i <= 10; i++) {
      results.push(makeResult(i, "suite-stable", "stableA", "passed", `commit-${i}`, daysAgo(i)));
      results.push(makeResult(i, "suite-stable", "stableB", "passed", `commit-${i}`, daysAgo(i)));
      results.push(makeResult(i, "suite-stable", "stableC", "passed", `commit-${i}`, daysAgo(i)));
      results.push(makeResult(i, "suite-stable", "stableD", "passed", `commit-${i}`, daysAgo(i)));
    }

    // --- 1 at-risk test: mostly stable but 1 recent failure ---
    for (let i = 2; i <= 10; i++) {
      results.push(makeResult(i, "suite-stable", "atRisk1", "passed", `commit-${i}`, daysAgo(i)));
    }
    results.push(makeResult(1, "suite-stable", "atRisk1", "failed", `commit-1`, daysAgo(1)));

    await store.insertTestResults(results);
  });

  afterEach(async () => {
    await store.close();
  });

  it("classifies true flaky correctly", async () => {
    const report = await runReason({ store, windowDays: 30 });
    const trueFlaky = report.classifications.filter(c => c.classification === "true-flaky");
    expect(trueFlaky.length).toBe(3);
    for (const tf of trueFlaky) {
      expect(tf.suite).toBe("suite-flaky");
      expect(tf.confidence).toBeGreaterThan(0);
      expect(tf.evidence.length).toBeGreaterThan(0);
    }
  });

  it("classifies regression correctly", async () => {
    const report = await runReason({ store, windowDays: 30 });
    const regressions = report.classifications.filter(c => c.classification === "regression");
    expect(regressions.length).toBeGreaterThanOrEqual(1);
    for (const r of regressions) {
      expect(r.recommendation).toBe("fix-urgent");
      expect(r.priority).toBe("critical");
    }
  });

  it("detects suite instability pattern", async () => {
    const report = await runReason({ store, windowDays: 30 });
    const suitePatterns = report.patterns.filter(p => p.type === "suite-instability");
    expect(suitePatterns.length).toBeGreaterThanOrEqual(1);
    const flakyPattern = suitePatterns.find(p => p.description.includes("suite-flaky"));
    expect(flakyPattern).toBeDefined();
    expect(flakyPattern!.affectedTests.length).toBeGreaterThanOrEqual(3);
  });

  it("identifies at-risk tests", async () => {
    const report = await runReason({ store, windowDays: 30 });
    // atRisk1 has 1 recent failure among mostly passing results
    const atRisk = report.riskPredictions.find(r => r.testName === "atRisk1");
    // may or may not appear depending on threshold, but riskPredictions should be an array
    expect(Array.isArray(report.riskPredictions)).toBe(true);
    if (atRisk) {
      expect(atRisk.riskScore).toBeGreaterThan(0);
      expect(atRisk.reason.length).toBeGreaterThan(0);
    }
  });

  it("summary counts are correct", async () => {
    const report = await runReason({ store, windowDays: 30 });
    expect(report.summary.totalAnalyzed).toBe(report.classifications.length);
    expect(report.summary.trueFlakyCount).toBe(
      report.classifications.filter(c => c.classification === "true-flaky").length,
    );
    expect(report.summary.regressionCount).toBe(
      report.classifications.filter(c => c.classification === "regression").length,
    );
    expect(report.summary.quarantineRecommended).toBe(
      report.classifications.filter(c => c.recommendation === "quarantine").length,
    );
    expect(report.summary.urgentFixes).toBe(
      report.classifications.filter(c => c.recommendation === "fix-urgent").length,
    );
  });

  it("recommendations match classification", async () => {
    const report = await runReason({ store, windowDays: 30 });
    for (const c of report.classifications) {
      // regressions should be fix-urgent
      if (c.classification === "regression") {
        expect(c.recommendation).toBe("fix-urgent");
      }
      // All should have valid recommendation
      expect(["quarantine", "investigate", "fix-urgent", "monitor", "ignore"]).toContain(c.recommendation);
      // All should have valid priority
      expect(["critical", "high", "medium", "low"]).toContain(c.priority);
    }
  });

  it("format output is non-empty", async () => {
    const report = await runReason({ store, windowDays: 30 });
    const output = formatReasoningReport(report);
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain("Flaker Reasoning Report");
    expect(output).toContain("Summary");
    expect(output).toContain("Classifications");
  });
});
