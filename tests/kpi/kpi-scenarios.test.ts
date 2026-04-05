import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { computeKpi } from "../../src/cli/commands/kpi.js";
import { analyzeProject } from "../../src/cli/commands/calibrate.js";

describe("KPI scenarios", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  // ── Helpers ──

  async function insertRun(
    id: number,
    sha: string,
    source: "ci" | "local" = "ci",
    event = "push",
  ) {
    await store.insertWorkflowRun({
      id,
      repo: "test/repo",
      branch: "main",
      commitSha: sha,
      event,
      source,
      status: "completed",
      createdAt: new Date(),
      durationMs: 60000,
    });
  }

  async function insertResults(
    runId: number,
    sha: string,
    tests: Array<{ suite: string; name: string; status: "passed" | "failed" }>,
  ) {
    await store.insertTestResults(
      tests.map((t) => ({
        workflowRunId: runId,
        suite: t.suite,
        testName: t.name,
        status: t.status,
        durationMs: 100,
        retryCount: 0,
        errorMessage: t.status === "failed" ? "test failure" : null,
        commitSha: sha,
        variant: null,
        createdAt: new Date(),
      })),
    );
  }

  async function insertChanges(sha: string, files: string[]) {
    await store.insertCommitChanges(
      sha,
      files.map((f) => ({
        filePath: f,
        changeType: "modified",
        additions: 10,
        deletions: 5,
      })),
    );
  }

  // ── Scenarios ──

  it("Scenario 1: Healthy project — all tests pass", async () => {
    // 10 commits, 20 tests, all pass
    for (let c = 0; c < 10; c++) {
      const sha = `healthy-${c}`;
      await insertRun(c + 1, sha);
      await insertChanges(sha, [`src/file_${c % 5}.ts`]);
      const tests = Array.from({ length: 20 }, (_, i) => ({
        suite: `suite_${i % 4}`,
        name: `test_${i}`,
        status: "passed" as const,
      }));
      await insertResults(c + 1, sha, tests);
    }

    const kpi = await computeKpi(store);
    expect(kpi.flaky.brokenTests).toBe(0);
    expect(kpi.flaky.intermittentFlaky).toBe(0);
    expect(kpi.flaky.trueFlakyRate).toBe(0);
    expect(kpi.data.coFailureCoverage).toBe(100);
    expect(kpi.data.coFailureReady).toBe(true);
  });

  it("Scenario 2: Project with broken tests — always fail", async () => {
    // 10 commits, 20 tests, 3 always fail
    for (let c = 0; c < 10; c++) {
      const sha = `broken-${c}`;
      await insertRun(c + 1, sha);
      await insertChanges(sha, [`src/main.ts`]);
      const tests = Array.from({ length: 20 }, (_, i) => ({
        suite: `suite_${i % 4}`,
        name: `test_${i}`,
        status: (i < 3 ? "failed" : "passed") as "passed" | "failed",
      }));
      await insertResults(c + 1, sha, tests);
    }

    const kpi = await computeKpi(store);
    expect(kpi.flaky.brokenTests).toBe(3);
    expect(kpi.flaky.intermittentFlaky).toBe(0);

    const profile = await analyzeProject(store, {
      hasResolver: false,
      hasGBDTModel: false,
    });
    expect(profile.brokenTestCount).toBe(3);
    expect(profile.intermittentFlakyCount).toBe(0);
    expect(profile.trueFlakyRate).toBe(0);
  });

  it("Scenario 3: Intermittent flaky — fails sometimes", async () => {
    // 10 commits, 20 tests, 2 tests fail 30% of the time
    for (let c = 0; c < 10; c++) {
      const sha = `flaky-${c}`;
      await insertRun(c + 1, sha);
      await insertChanges(sha, [`src/module_${c % 3}.ts`]);
      const tests = Array.from({ length: 20 }, (_, i) => {
        let status: "passed" | "failed" = "passed";
        // test_0 and test_1 fail 30% of the time
        if (i < 2 && c % 3 === 0) status = "failed";
        return { suite: `suite_${i % 4}`, name: `test_${i}`, status };
      });
      await insertResults(c + 1, sha, tests);
    }

    const kpi = await computeKpi(store);
    expect(kpi.flaky.brokenTests).toBe(0);
    // test_0 and test_1 should be detected as intermittent flaky
    expect(kpi.flaky.intermittentFlaky).toBeGreaterThanOrEqual(1);
    expect(kpi.flaky.trueFlakyRate).toBeGreaterThan(0);
  });

  it("Scenario 4: Co-failure correlation — file change → test failure", async () => {
    // When src/database.ts changes, db_test always fails
    // When other files change, db_test passes
    for (let c = 0; c < 10; c++) {
      const sha = `cofail-${c}`;
      await insertRun(c + 1, sha);
      const changedFile = c % 3 === 0 ? "src/database.ts" : `src/other_${c}.ts`;
      await insertChanges(sha, [changedFile]);
      const tests = [
        { suite: "db", name: "db_test", status: (c % 3 === 0 ? "failed" : "passed") as "passed" | "failed" },
        { suite: "ui", name: "ui_test", status: "passed" as const },
        { suite: "api", name: "api_test", status: "passed" as const },
      ];
      await insertResults(c + 1, sha, tests);
    }

    // co-failure should detect: database.ts → db_test
    const kpi = await computeKpi(store);
    expect(kpi.data.coFailureCoverage).toBe(100);
    expect(kpi.data.coFailureReady).toBe(true);

    const profile = await analyzeProject(store, {
      hasResolver: false,
      hasGBDTModel: false,
    });
    // co-failure strength should be > 0 because there's a real correlation
    expect(profile.hasCoFailureData).toBe(true);
    expect(profile.coFailureStrength).toBeGreaterThan(0);
  });

  it("Scenario 5: Missing co-failure data — no commit_changes", async () => {
    for (let c = 0; c < 10; c++) {
      const sha = `nochanges-${c}`;
      await insertRun(c + 1, sha);
      // No insertChanges call
      await insertResults(c + 1, sha, [
        { suite: "a", name: "test_1", status: "passed" },
      ]);
    }

    const kpi = await computeKpi(store);
    expect(kpi.data.commitsWithChanges).toBe(0);
    expect(kpi.data.coFailureCoverage).toBe(0);
    expect(kpi.data.coFailureReady).toBe(false);

    const profile = await analyzeProject(store, {
      hasResolver: false,
      hasGBDTModel: false,
    });
    expect(profile.hasCoFailureData).toBe(false);
  });

  it("Scenario 6: Mixed — broken + flaky + co-failure", async () => {
    // Real-world: 50 tests, 2 broken, 3 flaky, co-failure on 1
    for (let c = 0; c < 10; c++) {
      const sha = `mixed-${c}`;
      await insertRun(c + 1, sha);
      const changedFile = c % 2 === 0 ? "src/core.ts" : "src/utils.ts";
      await insertChanges(sha, [changedFile]);

      const tests: Array<{ suite: string; name: string; status: "passed" | "failed" }> = [];
      for (let i = 0; i < 50; i++) {
        let status: "passed" | "failed" = "passed";
        if (i < 2) {
          // Always broken
          status = "failed";
        } else if (i >= 2 && i < 5 && c % 4 === 0) {
          // Intermittent flaky (25%)
          status = "failed";
        } else if (i === 5 && changedFile === "src/core.ts") {
          // Co-failure: core.ts → test_5
          status = "failed";
        }
        tests.push({ suite: `suite_${i % 10}`, name: `test_${i}`, status });
      }
      await insertResults(c + 1, sha, tests);
    }

    const kpi = await computeKpi(store);
    expect(kpi.flaky.brokenTests).toBe(2);
    expect(kpi.flaky.intermittentFlaky).toBeGreaterThanOrEqual(1);
    expect(kpi.data.coFailureCoverage).toBe(100);

    const profile = await analyzeProject(store, {
      hasResolver: true,
      hasGBDTModel: false,
    });
    expect(profile.brokenTestCount).toBe(2);
    expect(profile.intermittentFlakyCount).toBeGreaterThanOrEqual(1);
    expect(profile.hasCoFailureData).toBe(true);
    expect(profile.coFailureStrength).toBeGreaterThan(0);
    // Strategy should be hybrid (resolver available, low true flaky rate)
    const { recommendSampling } = await import("../../src/cli/commands/calibrate.js");
    const sampling = recommendSampling(profile);
    expect(sampling.strategy).toBe("hybrid");
  });

  it("Scenario 7: Sampling validation — confusion matrix from matched commits", async () => {
    // Simulate: local sampling selected 3 of 10 tests, CI ran all 10
    // Test_0: sampled + CI failed (TP)
    // Test_1: sampled + CI passed (FP)
    // Test_2: sampled + CI passed (FP)
    // Test_3: skipped + CI failed (FN — missed bug!)
    // Test_4-9: skipped + CI passed (TN)
    const sha = "matched-sha-1";

    // CI run (source=ci)
    await insertRun(1, sha, "ci");
    const ciTests = Array.from({ length: 10 }, (_, i) => ({
      suite: "suite",
      name: `test_${i}`,
      status: (i === 0 || i === 3 ? "failed" : "passed") as "passed" | "failed",
    }));
    await insertResults(1, sha, ciTests);

    // Local sampling run (source=local)
    await insertRun(2, sha, "local", "flaker-local-run");
    // Record the sampling run
    const samplingRunId = await store.recordSamplingRun({
      commitSha: sha,
      commandKind: "run",
      strategy: "weighted",
      requestedCount: 3,
      requestedPercentage: null,
      seed: null,
      changedFiles: null,
      candidateCount: 10,
      selectedCount: 3,
      sampleRatio: 0.3,
      estimatedSavedTests: 7,
      estimatedSavedMinutes: null,
      fallbackReason: null,
      durationMs: 1000,
    });
    await store.recordSamplingRunTests([
      { samplingRunId, ordinal: 0, suite: "suite", testName: "test_0", testId: null, taskId: null, filter: null, isHoldout: false },
      { samplingRunId, ordinal: 1, suite: "suite", testName: "test_1", testId: null, taskId: null, filter: null, isHoldout: false },
      { samplingRunId, ordinal: 2, suite: "suite", testName: "test_2", testId: null, taskId: null, filter: null, isHoldout: false },
    ]);

    const kpi = await computeKpi(store);

    // Should have 1 matched commit
    expect(kpi.sampling.matchedCommits).toBe(1);

    // Confusion matrix
    expect(kpi.sampling.confusionMatrix).not.toBeNull();
    const cm = kpi.sampling.confusionMatrix!;
    expect(cm.truePositive).toBe(1);   // test_0: sampled + failed
    expect(cm.falsePositive).toBe(2);  // test_1, test_2: sampled + passed
    expect(cm.falseNegative).toBe(1);  // test_3: skipped + failed
    expect(cm.trueNegative).toBe(6);   // test_4-9: skipped + passed

    // Derived metrics
    expect(kpi.sampling.recall).toBe(50);  // 1 / (1+1) = 50%
    expect(kpi.sampling.falseNegativeRate).toBeCloseTo(14.3, 0); // 1/7 ≈ 14.3%
    expect(kpi.sampling.passCorrelation).toBeCloseTo(85.7, 0);   // 6/7 ≈ 85.7%
  });

  it("Scenario 8: Insufficient data — too few commits", async () => {
    // Only 2 commits
    for (let c = 0; c < 2; c++) {
      const sha = `few-${c}`;
      await insertRun(c + 1, sha);
      await insertResults(c + 1, sha, [
        { suite: "a", name: "test_1", status: "passed" },
      ]);
    }

    const kpi = await computeKpi(store);
    expect(kpi.data.confidence).toBe("insufficient");
    expect(kpi.data.commitCount).toBe(2);
  });
});
