import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { computeKpi } from "../../src/cli/commands/analyze/kpi.js";
import { analyzeProject } from "../../src/cli/commands/collect/calibrate.js";

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
    tests: Array<{ suite: string; name: string; status: "passed" | "failed" | "flaky" }>,
  ) {
    await store.insertTestResults(
      tests.map((t) => ({
        workflowRunId: runId,
        suite: t.suite,
        testName: t.name,
        status: t.status,
        durationMs: 100,
        retryCount: 0,
        errorMessage: t.status === "passed" ? null : "test failure",
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
        let status: "passed" | "failed" | "flaky" = "passed";
        // test_0 and test_1 flake 30% of the time (fail, then pass on retry)
        if (i < 2 && c % 3 === 0) status = "flaky";
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

      const tests: Array<{ suite: string; name: string; status: "passed" | "failed" | "flaky" }> = [];
      for (let i = 0; i < 50; i++) {
        let status: "passed" | "failed" | "flaky" = "passed";
        if (i < 2) {
          // Always broken
          status = "failed";
        } else if (i >= 2 && i < 5 && c % 4 === 0) {
          // Intermittent flaky (25%): fails, then passes on retry
          status = "flaky";
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
    });
    expect(profile.brokenTestCount).toBe(2);
    expect(profile.intermittentFlakyCount).toBeGreaterThanOrEqual(1);
    expect(profile.hasCoFailureData).toBe(true);
    expect(profile.coFailureStrength).toBeGreaterThan(0);
    // Strategy should be hybrid (resolver available, low true flaky rate)
    const { recommendSampling } = await import("../../src/cli/commands/collect/calibrate.js");
    const sampling = recommendSampling(profile);
    expect(sampling.strategy).toBe("hybrid");
  });

  it("Scenario 7: Sampling validation — commit-level confusion matrix and holdout FNR", async () => {
    // One engine (MoonBit build_sampling_kpi): per matched commit, did the
    // local sampled run fail, and did CI fail?
    //   c1: local fail, CI fail → TP    c2: local pass, CI fail → FN
    //   c3: local pass, CI pass → TN    c4: local fail, CI pass → FP
    const outcomes: Array<[string, boolean, boolean]> = [
      ["c1", true, true], ["c2", false, true], ["c3", false, false], ["c4", true, false],
    ];
    let runId = 1;
    for (const [sha, localFails, ciFails] of outcomes) {
      await insertRun(runId, sha, "ci");
      await insertResults(runId++, sha, Array.from({ length: 10 }, (_, i) => ({
        suite: "suite", name: `test_${i}`, status: (ciFails && i === 3 ? "failed" : "passed") as "passed" | "failed",
      })));
      await insertRun(runId, sha, "local", "flaker-local-run");
      await insertResults(runId++, sha, [0, 1, 2].map((i) => ({
        suite: "suite", name: `test_${i}`, status: (localFails && i === 0 ? "failed" : "passed") as "passed" | "failed",
      })));
      const samplingRunId = await store.recordSamplingRun({
        commitSha: sha, commandKind: "run", strategy: "weighted", requestedCount: 3, requestedPercentage: null,
        seed: null, changedFiles: null, candidateCount: 10, selectedCount: 3, sampleRatio: 0.3,
        estimatedSavedTests: 7, estimatedSavedMinutes: null, fallbackReason: null, durationMs: 1000,
      });
      // test_3 is held out on c2 (it fails in CI there) and c3 (it passes).
      if (sha === "c2" || sha === "c3") {
        await store.recordSamplingRunTests([
          { samplingRunId, ordinal: 0, suite: "suite", testName: "test_3", testId: null, taskId: null, filter: null, isHoldout: true },
        ]);
      }
    }

    const kpi = await computeKpi(store);
    expect(kpi.sampling.matchedCommits).toBe(4);
    expect(kpi.sampling.confusionMatrix).toEqual({ truePositive: 1, falsePositive: 1, falseNegative: 1, trueNegative: 1 });
    expect(kpi.sampling.recall).toBe(50);
    expect(kpi.sampling.falseNegativeRate).toBe(50);
    expect(kpi.sampling.passCorrelation).toBe(50);
    expect(kpi.sampling.sampleRatio).toBe(30);
    expect(kpi.sampling.holdoutFNR).toBe(50);
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
