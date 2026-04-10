import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { TestResult, WorkflowRun } from "../../src/cli/storage/types.js";
import {
  runEval,
  formatEvalReport,
  renderEvalReport,
  writeEvalReport,
} from "../../src/cli/commands/analyze/eval.js";

function makeRun(
  id: number,
  commitSha: string,
  createdAt: Date,
  overrides?: Partial<WorkflowRun>,
): WorkflowRun {
  return {
    id,
    repo: "owner/repo",
    branch: "main",
    commitSha,
    event: "push",
    status: "success",
    createdAt,
    durationMs: 60000,
    ...overrides,
  };
}

function makeResult(
  workflowRunId: number,
  suite: string,
  testName: string,
  status: string,
  commitSha: string,
  createdAt: Date,
): TestResult {
  return {
    workflowRunId,
    suite,
    testName,
    status,
    durationMs: 100,
    retryCount: 0,
    errorMessage: status === "failed" ? "error" : null,
    commitSha,
    variant: null,
    createdAt,
  };
}

describe("eval command", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("returns health score 70 with empty DB (no coverage data)", async () => {
    const report = await runEval({ store });
    // stability=100, coverage=0 (no data), resolution=100
    // health = 100*0.5 + 0*0.3 + 100*0.2 = 70
    expect(report.healthScore).toBe(70);
    expect(report.dataSufficiency.totalRuns).toBe(0);
    expect(report.dataSufficiency.totalResults).toBe(0);
    expect(report.dataSufficiency.uniqueTests).toBe(0);
    expect(report.detection.flakyTests).toBe(0);
    expect(report.resolution.resolvedFlaky).toBe(0);
  });

  it("returns high health score with all-passing tests", async () => {
    const now = new Date();
    await store.insertWorkflowRun(makeRun(1, "abc123", now));

    const results: TestResult[] = [];
    // 10 passing results for each of 3 tests
    for (let i = 0; i < 10; i++) {
      results.push(makeResult(1, "suite-a", "testA", "passed", "abc123", now));
      results.push(makeResult(1, "suite-a", "testB", "passed", "abc123", now));
      results.push(makeResult(1, "suite-a", "testC", "passed", "abc123", now));
    }
    await store.insertTestResults(results);

    const report = await runEval({ store });
    expect(report.dataSufficiency.totalResults).toBe(30);
    expect(report.dataSufficiency.uniqueTests).toBe(3);
    expect(report.dataSufficiency.avgRunsPerTest).toBe(10);
    expect(report.detection.flakyTests).toBe(0);
    // stability=100, coverage=min(10/10,1)*100=100, resolution=100
    // health = 100*0.5 + 100*0.3 + 100*0.2 = 100
    expect(report.healthScore).toBe(100);
  });

  it("returns lower health score with flaky tests", async () => {
    const now = new Date();
    await store.insertWorkflowRun(makeRun(1, "abc123", now));

    const results: TestResult[] = [];
    // 10 results for flakyTest: 5 failed, 5 passed
    for (let i = 0; i < 10; i++) {
      results.push(
        makeResult(1, "suite-a", "flakyTest", i < 5 ? "failed" : "passed", "abc123", now),
      );
    }
    // 10 results for stableTest: all passed
    for (let i = 0; i < 10; i++) {
      results.push(makeResult(1, "suite-a", "stableTest", "passed", "abc123", now));
    }
    await store.insertTestResults(results);

    const report = await runEval({ store });
    expect(report.detection.flakyTests).toBe(1);
    expect(report.dataSufficiency.uniqueTests).toBe(2);
    // stability = (2-1)/2 * 100 = 50
    // coverage = min(10/10,1)*100 = 100
    // resolution depends on data timing, but no resolved flaky here
    expect(report.healthScore).toBeLessThan(100);
    expect(report.detection.distribution.some((d) => d.count > 0)).toBe(true);
  });

  it("detects resolved flaky tests", async () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const now = new Date();

    await store.insertWorkflowRun(makeRun(1, "old111", twoWeeksAgo));
    await store.insertWorkflowRun(makeRun(2, "new222", now));

    const results: TestResult[] = [];
    // Old flaky results (2 weeks ago)
    for (let i = 0; i < 5; i++) {
      results.push(
        makeResult(1, "suite-a", "resolvedTest", i < 3 ? "failed" : "passed", "old111", twoWeeksAgo),
      );
    }
    // Recent passing results (now, within last 7 days)
    for (let i = 0; i < 5; i++) {
      results.push(makeResult(2, "suite-a", "resolvedTest", "passed", "new222", now));
    }
    await store.insertTestResults(results);

    const report = await runEval({ store });
    expect(report.resolution.resolvedFlaky).toBe(1);
  });

  it("formats report correctly", async () => {
    const report = await runEval({ store });
    const formatted = formatEvalReport(report);
    expect(formatted).toContain("Health Score");
    expect(formatted).toContain("Data Sufficiency");
    expect(formatted).toContain("Detection");
    expect(formatted).toContain("Resolution");
    expect(formatted).toContain("Sampling KPI");
    expect(formatted).toContain("Recommendations");
  });

  it("computes local-to-ci sampling KPI per commit", async () => {
    const now = new Date();
    const ciTests = ["ci-a", "ci-b", "ci-c", "ci-d"];
    const localTests = ["local-a", "local-b"];

    const commits = [
      {
        commitSha: "commit-pass",
        localFailed: false,
        ciFailed: false,
      },
      {
        commitSha: "commit-fail",
        localFailed: true,
        ciFailed: true,
      },
      {
        commitSha: "commit-fn",
        localFailed: false,
        ciFailed: true,
      },
      {
        commitSha: "commit-fp",
        localFailed: true,
        ciFailed: false,
      },
    ] as const;

    let runId = 1;
    for (const commit of commits) {
      const localRunId = runId++;
      const ciRunId = runId++;
      await store.insertWorkflowRun(
        makeRun(localRunId, commit.commitSha, now, {
          event: "flaker-local-run",
          branch: "local",
          status: "completed",
          durationMs: 20_000 + (runId - 2) * 5_000,
        }),
      );
      await store.insertWorkflowRun(
        makeRun(ciRunId, commit.commitSha, now, {
          event: "push",
          branch: "main",
          status: "completed",
          durationMs: 80_000 + (runId - 3) * 5_000,
        }),
      );
      await store.recordSamplingRun({
        commitSha: commit.commitSha,
        commandKind: "run",
        strategy: "hybrid",
        requestedCount: 2,
        requestedPercentage: null,
        seed: 42,
        changedFiles: ["src/example.ts"],
        candidateCount: 4,
        selectedCount: 2,
        sampleRatio: 50,
        estimatedSavedTests: 2,
        estimatedSavedMinutes: 1,
        fallbackReason: commit.commitSha === "commit-fail" ? "cold-start-listed-tests" : null,
        durationMs: 20_000 + (runId - 2) * 5_000,
        createdAt: now,
      });

      await store.insertTestResults(
        localTests.map((testName, index) =>
          makeResult(
            localRunId,
            "suite-local",
            testName,
            commit.localFailed && index === 0 ? "failed" : "passed",
            commit.commitSha,
            now,
          ),
        ),
      );
      await store.insertTestResults(
        ciTests.map((testName, index) =>
          makeResult(
            ciRunId,
            "suite-ci",
            testName,
            commit.ciFailed && index === 0 ? "failed" : "passed",
            commit.commitSha,
            now,
          ),
        ),
      );
    }

    await store.insertWorkflowRun(
      makeRun(runId++, "local-only", now, {
        event: "flaker-local-run",
        branch: "local",
        status: "completed",
        durationMs: 10_000,
      }),
    );
    await store.recordSamplingRun({
      commitSha: "local-only",
      commandKind: "run",
      strategy: "hybrid",
      requestedCount: 1,
      requestedPercentage: null,
      seed: 42,
      changedFiles: ["src/orphan.ts"],
      candidateCount: 1,
      selectedCount: 1,
      sampleRatio: 100,
      estimatedSavedTests: 0,
      estimatedSavedMinutes: 0,
      fallbackReason: "cold-start-listed-tests",
      durationMs: 10_000,
      createdAt: now,
    });
    await store.insertTestResults([
      makeResult(runId - 1, "suite-local", "orphan-local", "passed", "local-only", now),
    ]);

    await store.insertWorkflowRun(
      makeRun(runId++, "ci-only", now, {
        event: "pull_request",
        branch: "main",
        status: "completed",
      }),
    );
    await store.insertTestResults([
      makeResult(runId - 1, "suite-ci", "orphan-ci", "passed", "ci-only", now),
    ]);

    const report = await runEval({ store });

    expect(report.samplingKpi.matchedCommits).toBe(4);
    expect(report.samplingKpi.localOnlyCommits).toBe(1);
    expect(report.samplingKpi.ciOnlyCommits).toBe(1);
    expect(report.samplingKpi.avgLocalSampleSize).toBe(2);
    expect(report.samplingKpi.medianLocalSampleSize).toBe(2);
    expect(report.samplingKpi.p95LocalSampleSize).toBe(2);
    expect(report.samplingKpi.avgCiTestCount).toBe(4);
    expect(report.samplingKpi.avgSampleRatio).toBe(50);
    expect(report.samplingKpi.avgSavedMinutes).toBe(0.9);
    expect(report.samplingKpi.fallbackRuns).toBe(2);
    expect(report.samplingKpi.fallbackRate).toBe(40);
    expect(report.samplingKpi.passSignal.localPassCommits).toBe(2);
    expect(report.samplingKpi.passSignal.ciPassWhenLocalPass).toBe(1);
    expect(report.samplingKpi.passSignal.rate).toBe(50);
    expect(report.samplingKpi.failSignal.localFailCommits).toBe(2);
    expect(report.samplingKpi.failSignal.ciFailWhenLocalFail).toBe(1);
    expect(report.samplingKpi.failSignal.rate).toBe(50);
    expect(report.samplingKpi.misses.localPassButCiFail).toBe(1);
    expect(report.samplingKpi.misses.localFailButCiPass).toBe(1);
    expect(report.samplingKpi.misses.falseNegativeRate).toBe(50);
    expect(report.samplingKpi.misses.falsePositiveRate).toBe(50);
    expect(report.samplingKpi.confusionMatrix.truePositive).toBe(1);
    expect(report.samplingKpi.confusionMatrix.falsePositive).toBe(1);
    expect(report.samplingKpi.confusionMatrix.falseNegative).toBe(1);
    expect(report.samplingKpi.confusionMatrix.trueNegative).toBe(1);
  });

  it("formats saved minutes and fallback rate in the report", async () => {
    const report = await runEval({ store });
    report.samplingKpi.avgSavedMinutes = 12.5;
    report.samplingKpi.fallbackRuns = 3;
    report.samplingKpi.fallbackRate = 15;

    const formatted = formatEvalReport(report);

    expect(formatted).toContain("Avg saved minutes:");
    expect(formatted).toContain("Fallback rate:");
  });

  it("formats markdown review output with windowed sampling KPI", async () => {
    const report = await runEval({ store });
    report.healthScore = 88;
    report.detection.flakyTests = 4;
    report.samplingKpi.matchedCommits = 12;
    report.samplingKpi.avgSampleRatio = 18.2;
    report.samplingKpi.avgSavedMinutes = 14.7;
    report.samplingKpi.fallbackRuns = 1;
    report.samplingKpi.fallbackRate = 8.3;
    report.samplingKpi.passSignal.localPassCommits = 10;
    report.samplingKpi.passSignal.ciPassWhenLocalPass = 10;
    report.samplingKpi.passSignal.rate = 100;
    report.samplingKpi.failSignal.localFailCommits = 2;
    report.samplingKpi.failSignal.ciFailWhenLocalFail = 1;
    report.samplingKpi.failSignal.rate = 50;

    const formatted = formatEvalReport(report, "markdown", { windowDays: 7 });

    expect(formatted).toContain("# flaker Review (last 7 days)");
    expect(formatted).toContain("| Metric | Value |");
    expect(formatted).toContain("| Avg saved minutes | 14.7 min |");
    expect(formatted).toContain("| Fallback rate | 8.3% (1) |");
    expect(formatted).toContain("| CI pass when local pass | 100% (10/10) |");
  });

  it("renders raw JSON when requested", async () => {
    const report = await runEval({ store });

    const rendered = renderEvalReport(report, { json: true });

    expect(JSON.parse(rendered)).toMatchObject({
      healthScore: report.healthScore,
      dataSufficiency: {
        totalRuns: report.dataSufficiency.totalRuns,
      },
    });
  });

  it("writes rendered eval output to a file", async () => {
    const report = await runEval({ store });
    const dir = mkdtempSync(join(tmpdir(), "flaker-eval-"));
    const outputPath = join(dir, "review.md");

    writeEvalReport(
      outputPath,
      renderEvalReport(report, { markdown: true, windowDays: 7 }),
    );

    expect(existsSync(outputPath)).toBe(true);
    expect(readFileSync(outputPath, "utf-8")).toContain("# flaker Review (last 7 days)");
  });
});
