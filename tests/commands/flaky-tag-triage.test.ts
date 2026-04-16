import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { WorkflowRun, TestResult } from "../../src/cli/storage/types.js";
import type { RunnerAdapter } from "../../src/cli/runners/types.js";
import { runFlakyTagTriage } from "../../src/cli/commands/analyze/flaky-tag-triage.js";

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
    source: "ci",
    status: "success",
    createdAt,
    durationMs: 60_000,
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
  overrides?: Partial<TestResult>,
): TestResult {
  return {
    workflowRunId,
    suite,
    testName,
    status,
    durationMs: 100,
    retryCount: 0,
    errorMessage: status === "failed" ? "boom" : null,
    commitSha,
    variant: null,
    createdAt,
    ...overrides,
  };
}

describe("flaky tag triage", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("suggests adding tags to unstable tests and removing tags after consecutive passes", async () => {
    const now = new Date("2026-04-16T00:00:00Z");
    const runner: RunnerAdapter = {
      name: "playwright",
      capabilities: { nativeParallel: true },
      async listTests() {
        return [
          {
            suite: "tests/remove.spec.ts",
            testName: "remove candidate",
            taskId: "tests/remove.spec.ts",
            tags: ["@flaky"],
          },
          {
            suite: "tests/keep.spec.ts",
            testName: "keep tagged",
            taskId: "tests/keep.spec.ts",
            tags: ["@flaky"],
          },
          {
            suite: "tests/add.spec.ts",
            testName: "add candidate",
            taskId: "tests/add.spec.ts",
          },
        ];
      },
      async execute() {
        throw new Error("not used");
      },
    };

    const runs = [
      makeRun(1, "sha-1", new Date("2026-04-10T00:00:00Z")),
      makeRun(2, "sha-2", new Date("2026-04-11T00:00:00Z")),
      makeRun(3, "sha-3", new Date("2026-04-12T00:00:00Z")),
      makeRun(4, "sha-4", new Date("2026-04-13T00:00:00Z")),
      makeRun(5, "sha-5", new Date("2026-04-14T00:00:00Z")),
      makeRun(6, "sha-6", new Date("2026-04-15T00:00:00Z")),
    ];
    for (const run of runs) {
      await store.insertWorkflowRun(run);
    }

    await store.insertTestResults([
      makeResult(6, "tests/remove.spec.ts", "remove candidate", "passed", "sha-6", new Date("2026-04-15T00:00:00Z")),
      makeResult(5, "tests/remove.spec.ts", "remove candidate", "passed", "sha-5", new Date("2026-04-14T00:00:00Z")),
      makeResult(4, "tests/remove.spec.ts", "remove candidate", "passed", "sha-4", new Date("2026-04-13T00:00:00Z")),

      makeResult(6, "tests/keep.spec.ts", "keep tagged", "failed", "sha-6", new Date("2026-04-15T00:00:00Z")),
      makeResult(5, "tests/keep.spec.ts", "keep tagged", "passed", "sha-5", new Date("2026-04-14T00:00:00Z")),
      makeResult(4, "tests/keep.spec.ts", "keep tagged", "failed", "sha-4", new Date("2026-04-13T00:00:00Z")),

      makeResult(6, "tests/add.spec.ts", "add candidate", "failed", "sha-6", new Date("2026-04-15T00:00:00Z")),
      makeResult(5, "tests/add.spec.ts", "add candidate", "passed", "sha-5", new Date("2026-04-14T00:00:00Z"), {
        retryCount: 1,
      }),
      makeResult(4, "tests/add.spec.ts", "add candidate", "failed", "sha-4", new Date("2026-04-13T00:00:00Z")),
      makeResult(3, "tests/add.spec.ts", "add candidate", "passed", "sha-3", new Date("2026-04-12T00:00:00Z")),
      makeResult(2, "tests/add.spec.ts", "add candidate", "passed", "sha-2", new Date("2026-04-11T00:00:00Z")),
    ]);

    const report = await runFlakyTagTriage({
      store,
      runner,
      cwd: process.cwd(),
      now,
      tagPattern: "@flaky",
      windowDays: 30,
      addThresholdPercentage: 30,
      minRuns: 3,
      removeAfterConsecutivePasses: 3,
    });

    expect(report.summary.taggedCount).toBe(2);
    expect(report.summary.addCandidateCount).toBe(1);
    expect(report.summary.removeCandidateCount).toBe(1);
    expect(report.summary.keepTaggedCount).toBe(1);

    expect(report.suggestions.add).toEqual([
      expect.objectContaining({
        suite: "tests/add.spec.ts",
        testName: "add candidate",
        totalRuns: 5,
        failCount: 2,
        flakyRetryCount: 1,
        flakyRate: 60,
        recommendedAction: "add-tag",
      }),
    ]);
    expect(report.suggestions.remove).toEqual([
      expect.objectContaining({
        suite: "tests/remove.spec.ts",
        testName: "remove candidate",
        consecutivePasses: 3,
        recommendedAction: "remove-tag",
      }),
    ]);
    expect(report.suggestions.keep).toEqual([
      expect.objectContaining({
        suite: "tests/keep.spec.ts",
        testName: "keep tagged",
        recommendedAction: "keep-tag",
      }),
    ]);
  });
});
