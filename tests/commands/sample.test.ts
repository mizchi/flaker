import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { TestResult, WorkflowRun } from "../../src/cli/storage/types.js";
import {
  formatSamplingSummary,
  planSample,
  prepareSamplingMeta,
  runSample,
} from "../../src/cli/commands/exec/plan.js";
import type { DependencyResolver } from "../../src/cli/resolvers/types.js";
import { loadCore } from "../../src/cli/core/loader.js";

describe("sample command", () => {
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

    // Seed 20 tests: 3 flaky (mixed pass/fail), 17 stable (all pass)
    const results: TestResult[] = [];

    // 3 flaky tests: each has 2 runs (1 failed, 1 passed)
    for (let i = 0; i < 3; i++) {
      results.push({
        workflowRunId: 1,
        suite: "suite-a",
        testName: `flaky-test-${i}`,
        status: "failed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: "timeout",
        commitSha: "abc123",
        variant: null,
        createdAt: new Date(),
      });
      results.push({
        workflowRunId: 1,
        suite: "suite-a",
        testName: `flaky-test-${i}`,
        status: "passed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc123",
        variant: null,
        createdAt: new Date(),
      });
    }

    // 17 stable tests: each has 2 runs (all passed)
    for (let i = 0; i < 17; i++) {
      results.push({
        workflowRunId: 1,
        suite: "suite-a",
        testName: `stable-test-${i}`,
        status: "passed",
        durationMs: 50,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc123",
        variant: null,
        createdAt: new Date(),
      });
      results.push({
        workflowRunId: 1,
        suite: "suite-a",
        testName: `stable-test-${i}`,
        status: "passed",
        durationMs: 50,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc123",
        variant: null,
        createdAt: new Date(),
      });
    }

    await store.insertTestResults(results);
  });

  afterEach(async () => {
    await store.close();
  });

  it("random returns correct count", async () => {
    const sampled = await runSample({
      store,
      count: 5,
      mode: "random",
      seed: 42,
    });
    expect(sampled).toHaveLength(5);
  });

  it("weighted returns correct count", async () => {
    const sampled = await runSample({
      store,
      count: 5,
      mode: "weighted",
      seed: 42,
    });
    expect(sampled).toHaveLength(5);
  });

  it("percentage mode works (50% of 20 = 10)", async () => {
    const sampled = await runSample({
      store,
      percentage: 50,
      mode: "random",
      seed: 42,
    });
    expect(sampled).toHaveLength(10);
  });

  it("uses precomputed sampling meta without querying store history", async () => {
    const core = await loadCore();
    const samplingMeta = await prepareSamplingMeta(store, [], core);
    const rawSpy = vi.spyOn(store, "raw").mockRejectedValue(new Error("history query should not run"));

    const plan = await planSample({
      store,
      count: 1,
      mode: "weighted",
      seed: 42,
      samplingMeta,
    });

    expect(plan.sampled).toHaveLength(1);
    expect(rawSpy).not.toHaveBeenCalled();
  });
});

describe("sample command without history", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("falls back to listedTests when the store has no test history", async () => {
    const sampled = await runSample({
      store,
      mode: "random",
      count: 2,
      seed: 42,
      listedTests: [
        {
          suite: "third_party/git/t/t1300-config.sh",
          testName: "t1300-config.sh",
          taskId: "git-compat",
        },
        {
          suite: "third_party/git/t/t3200-branch.sh",
          testName: "t3200-branch.sh",
          taskId: "git-compat",
        },
        {
          suite: "third_party/git/t/t5302-pack-index.sh",
          testName: "t5302-pack-index.sh",
          taskId: "git-compat",
        },
      ],
    });

    expect(sampled).toHaveLength(2);
    expect(sampled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          suite: expect.stringMatching(/^third_party\/git\/t\/t\d+/),
          is_new: true,
          total_runs: 0,
        }),
      ]),
    );
  });

  it("supports affected mode from listedTests on cold start", async () => {
    const resolver: DependencyResolver = {
      resolve(changedFiles, allTestFiles) {
        expect(changedFiles).toEqual(["src/cmd/bit/verify_tag.mbt"]);
        expect(allTestFiles).toEqual([
          "third_party/git/t/t7004-tag.sh",
          "third_party/git/t/t7030-verify-tag.sh",
          "third_party/git/t/t7031-verify-tag-signed-ssh.sh",
        ]);
        return [
          "third_party/git/t/t7004-tag.sh",
          "third_party/git/t/t7030-verify-tag.sh",
        ];
      },
    };

    const sampled = await runSample({
      store,
      mode: "affected",
      resolver,
      changedFiles: ["src/cmd/bit/verify_tag.mbt"],
      listedTests: [
        {
          suite: "third_party/git/t/t7004-tag.sh",
          testName: "t7004-tag.sh",
          taskId: "git-compat",
        },
        {
          suite: "third_party/git/t/t7030-verify-tag.sh",
          testName: "t7030-verify-tag.sh",
          taskId: "git-compat",
        },
        {
          suite: "third_party/git/t/t7031-verify-tag-signed-ssh.sh",
          testName: "t7031-verify-tag-signed-ssh.sh",
          taskId: "git-compat",
        },
      ],
    });

    expect(sampled).toHaveLength(2);
    expect(sampled.map((entry) => entry.suite)).toEqual([
      "third_party/git/t/t7004-tag.sh",
      "third_party/git/t/t7030-verify-tag.sh",
    ]);
  });

  it("marks listedTests cold start as a fallback reason", async () => {
    const plan = await planSample({
      store,
      mode: "random",
      count: 2,
      seed: 42,
      listedTests: [
        {
          suite: "third_party/git/t/t7004-tag.sh",
          testName: "t7004-tag.sh",
          taskId: "git-compat",
        },
        {
          suite: "third_party/git/t/t7030-verify-tag.sh",
          testName: "t7030-verify-tag.sh",
          taskId: "git-compat",
        },
        {
          suite: "third_party/git/t/t7031-verify-tag-signed-ssh.sh",
          testName: "t7031-verify-tag-signed-ssh.sh",
          taskId: "git-compat",
        },
      ],
    });

    expect(plan.summary.candidateCount).toBe(3);
    expect(plan.summary.selectedCount).toBe(2);
    expect(plan.summary.fallbackReason).toBe("cold-start-listed-tests");
  });

  it("formats a human-readable sampling summary", () => {
    const output = formatSamplingSummary(
      {
        strategy: "hybrid",
        requestedCount: 25,
        requestedPercentage: null,
        seed: 42,
        changedFiles: ["src/cmd/bit/verify_tag.mbt"],
        candidateCount: 100,
        selectedCount: 15,
        holdoutCount: 0,
        sampleRatio: 15,
        estimatedSavedTests: 85,
        estimatedSavedMinutes: 12.3,
        fallbackReason: "cold-start-listed-tests",
      },
      {
        ciPassWhenLocalPassRate: 97.2,
      },
    );

    expect(output).toContain("Selected tests:           15 / 100 (15%)");
    expect(output).toContain("Estimated saved tests:    85");
    expect(output).toContain("Estimated saved minutes:  12.3");
    expect(output).toContain("CI pass when local pass:  97.2%");
    expect(output).toContain("Fallback reason:          cold-start-listed-tests");
    expect(output).toContain("Fallback details:         No historical test results were found");
    expect(output).toContain("Next action:              Run `flaker collect` or `flaker import`");
    expect(output).toContain("History target:           Aim for >= 5 runs/test");
  });

  it("supports hybrid mode from listedTests on cold start", async () => {
    const resolver: DependencyResolver = {
      resolve() {
        return ["third_party/git/t/t7030-verify-tag.sh"];
      },
    };

    const sampled = await runSample({
      store,
      mode: "hybrid",
      count: 2,
      seed: 7,
      resolver,
      changedFiles: ["src/cmd/bit/verify_tag.mbt"],
      listedTests: [
        {
          suite: "third_party/git/t/t7004-tag.sh",
          testName: "t7004-tag.sh",
          taskId: "git-compat",
        },
        {
          suite: "third_party/git/t/t7030-verify-tag.sh",
          testName: "t7030-verify-tag.sh",
          taskId: "git-compat",
        },
        {
          suite: "third_party/git/t/t7031-verify-tag-signed-ssh.sh",
          testName: "t7031-verify-tag-signed-ssh.sh",
          taskId: "git-compat",
        },
      ],
    });

    expect(sampled).toHaveLength(2);
    expect(sampled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          suite: "third_party/git/t/t7030-verify-tag.sh",
        }),
      ]),
    );
  });

  it("falls back to a configured strategy when affected selects nothing", async () => {
    await store.insertWorkflowRun({
      id: 1,
      repo: "test/repo",
      branch: "main",
      commitSha: "abc",
      event: "push",
      status: "completed",
      createdAt: new Date(),
      durationMs: 1000,
    });
    await store.insertTestResults([
      {
        workflowRunId: 1,
        suite: "tests/commands/eval.test.ts",
        testName: "renders raw JSON when requested",
        status: "passed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc",
        variant: null,
        createdAt: new Date(),
      },
    ]);

    const plan = await planSample({
      store,
      mode: "affected",
      fallbackMode: "weighted",
      count: 1,
      seed: 42,
      changedFiles: ["src/unmatched/file.ts"],
      resolver: {
        resolve() {
          return [];
        },
      },
      listedTests: [
        {
          suite: "tests/commands/eval.test.ts",
          testName: "renders raw JSON when requested",
          taskId: "commands-eval",
        },
      ],
    });

    expect(plan.sampled).toHaveLength(1);
    expect(plan.summary.strategy).toBe("weighted");
    expect(plan.summary.selectedCount).toBe(1);
  });
});

describe("sample command with stable identity history", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
    await store.insertWorkflowRun({
      id: 1,
      repo: "owner/repo",
      branch: "main",
      commitSha: "abc123",
      event: "push",
      status: "success",
      createdAt: new Date("2026-04-01T00:00:00Z"),
      durationMs: 60000,
    });
  });

  afterEach(async () => {
    await store.close();
  });

  it("keeps split task and filter identities separate when suite and test name collide", async () => {
    await store.insertTestResults([
      {
        workflowRunId: 1,
        suite: "tests/shared.spec.ts",
        testName: "renders shared flow",
        taskId: "desktop",
        filter: "@desktop",
        status: "passed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc123",
        variant: null,
        createdAt: new Date("2026-04-01T00:00:00Z"),
      },
      {
        workflowRunId: 1,
        suite: "tests/shared.spec.ts",
        testName: "renders shared flow",
        taskId: "mobile",
        filter: "@mobile",
        status: "passed",
        durationMs: 120,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc123",
        variant: null,
        createdAt: new Date("2026-04-01T00:01:00Z"),
      },
    ]);

    const sampled = await runSample({
      store,
      count: 10,
      mode: "random",
      seed: 42,
    });

    expect(sampled).toHaveLength(2);
    expect(sampled.map((entry) => entry.task_id).sort()).toEqual([
      "desktop",
      "mobile",
    ]);
    expect(new Set(sampled.map((entry) => entry.test_id)).size).toBe(2);
  });

  it("treats retry passes as flaky signals in sampling metadata", async () => {
    await store.insertTestResults([
      {
        workflowRunId: 1,
        suite: "tests/retry.spec.ts",
        testName: "eventually passes",
        taskId: "retry",
        status: "passed",
        durationMs: 100,
        retryCount: 1,
        errorMessage: null,
        commitSha: "abc123",
        variant: null,
        createdAt: new Date("2026-04-01T00:00:00Z"),
      },
      {
        workflowRunId: 1,
        suite: "tests/retry.spec.ts",
        testName: "eventually passes",
        taskId: "retry",
        status: "passed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc123",
        variant: null,
        createdAt: new Date("2026-04-01T00:01:00Z"),
      },
    ]);

    const sampled = await runSample({
      store,
      count: 10,
      mode: "random",
      seed: 42,
    });

    expect(sampled).toHaveLength(1);
    expect(sampled[0]).toMatchObject({
      suite: "tests/retry.spec.ts",
      flaky_rate: 50,
      previously_failed: true,
    });
  });
});
