import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { WorkflowRun, TestResult } from "../../src/cli/storage/types.js";
import { runQuarantineSuggest } from "../../src/cli/commands/quarantine/suggest.js";

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

describe("quarantine suggest", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("emits a versioned plan with add and remove suggestions", async () => {
    const now = new Date("2026-04-19T00:00:00Z");
    await store.insertWorkflowRun(makeRun(1, "sha-1", now));

    await store.insertTestResults([
      makeResult(1, "tests/add.spec.ts", "add candidate", "failed", "sha-1", now),
      makeResult(1, "tests/add.spec.ts", "add candidate", "failed", "sha-1", now),
      makeResult(1, "tests/add.spec.ts", "add candidate", "passed", "sha-1", now, { retryCount: 1 }),
      makeResult(1, "tests/add.spec.ts", "add candidate", "passed", "sha-1", now),
      makeResult(1, "tests/add.spec.ts", "add candidate", "passed", "sha-1", now),

      makeResult(1, "tests/remove.spec.ts", "remove candidate", "failed", "sha-1", now),
      makeResult(1, "tests/remove.spec.ts", "remove candidate", "passed", "sha-1", now),
      makeResult(1, "tests/remove.spec.ts", "remove candidate", "passed", "sha-1", now),
      makeResult(1, "tests/remove.spec.ts", "remove candidate", "passed", "sha-1", now),
      makeResult(1, "tests/remove.spec.ts", "remove candidate", "passed", "sha-1", now),
    ]);

    await store.addQuarantine(
      { suite: "tests/remove.spec.ts", testName: "remove candidate" },
      "auto:flaky_rate>=30%",
    );

    const plan = await runQuarantineSuggest({
      store,
      now,
      windowDays: 30,
      flakyRateThresholdPercentage: 30,
      minRuns: 5,
    });

    expect(plan.version).toBe(1);
    expect(plan.scope).toEqual({ branch: "main", days: 30 });
    expect(plan.thresholds).toEqual({
      flakyRateThresholdPercentage: 30,
      minRuns: 5,
    });
    expect(plan.add).toEqual([
      expect.objectContaining({
        selector: expect.objectContaining({
          suite: "tests/add.spec.ts",
          testName: "add candidate",
        }),
        reason: "flaky_rate_exceeded",
        confidence: "moderate",
        evidence: expect.objectContaining({
          flakeRatePercentage: 60,
          totalRuns: 5,
        }),
      }),
    ]);
    expect(plan.remove).toEqual([
      expect.objectContaining({
        selector: expect.objectContaining({
          suite: "tests/remove.spec.ts",
          testName: "remove candidate",
        }),
        reason: "below_threshold",
        evidence: expect.objectContaining({
          flakeRatePercentage: 20,
          totalRuns: 5,
          currentReason: "auto:flaky_rate>=30%",
        }),
      }),
    ]);
  });
});
