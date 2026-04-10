import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { planSample } from "../../src/cli/commands/exec/plan.js";

describe("sample with co-failure boost", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();

    for (let i = 1; i <= 4; i++) {
      await store.insertWorkflowRun({
        id: i, repo: "test/repo", branch: "main", commitSha: `sha${i}`,
        event: "push", status: "completed",
        createdAt: new Date(Date.now() - (5 - i) * 86400000), durationMs: 60000,
      });
    }

    // sha1, sha2, sha3: change src/auth.ts, login test fails (3 co-runs to meet minCoRuns=3)
    for (const [sha, runId] of [["sha1", 1], ["sha2", 2], ["sha3", 3]] as const) {
      await store.insertCommitChanges(sha, [
        { filePath: "src/auth.ts", changeType: "modified", additions: 5, deletions: 2 },
      ]);
      await store.insertTestResults([
        {
          workflowRunId: runId, suite: "tests/login.spec.ts", testName: "login works",
          status: "failed", durationMs: 100, retryCount: 0, errorMessage: "err",
          commitSha: sha, variant: null, createdAt: new Date(Date.now() - (5 - runId) * 86400000),
        },
        {
          workflowRunId: runId, suite: "tests/signup.spec.ts", testName: "signup works",
          status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
          commitSha: sha, variant: null, createdAt: new Date(Date.now() - (5 - runId) * 86400000),
        },
        {
          workflowRunId: runId, suite: "tests/dashboard.spec.ts", testName: "dashboard loads",
          status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
          commitSha: sha, variant: null, createdAt: new Date(Date.now() - (5 - runId) * 86400000),
        },
      ]);
    }

    // sha4: change src/ui.ts, everything passes
    await store.insertCommitChanges("sha4", [
      { filePath: "src/ui.ts", changeType: "modified", additions: 10, deletions: 0 },
    ]);
    await store.insertTestResults([
      {
        workflowRunId: 4, suite: "tests/login.spec.ts", testName: "login works",
        status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
        commitSha: "sha4", variant: null, createdAt: new Date(Date.now() - 86400000),
      },
      {
        workflowRunId: 4, suite: "tests/signup.spec.ts", testName: "signup works",
        status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
        commitSha: "sha4", variant: null, createdAt: new Date(Date.now() - 86400000),
      },
      {
        workflowRunId: 4, suite: "tests/dashboard.spec.ts", testName: "dashboard loads",
        status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
        commitSha: "sha4", variant: null, createdAt: new Date(Date.now() - 86400000),
      },
    ]);
  });

  afterEach(async () => {
    await store.close();
  });

  it("weighted sampling with co-failure boost prioritizes correlated tests", async () => {
    const plan = await planSample({
      store,
      count: 1,
      mode: "weighted",
      seed: 42,
      changedFiles: ["src/auth.ts"],
    });

    expect(plan.sampled).toHaveLength(1);
    // login test has highest weight: flaky_rate (100% = failed in 2/3 runs) + co_failure_boost (1.0)
    expect(plan.sampled[0].suite).toBe("tests/login.spec.ts");
  });

  it("sampling without changedFiles has no co-failure boost", async () => {
    const plan = await planSample({
      store,
      count: 3,
      mode: "weighted",
      seed: 42,
    });

    expect(plan.sampled).toHaveLength(3);
    // All tests should have co_failure_boost = 0
    for (const test of plan.allTests) {
      expect(test.co_failure_boost).toBe(0);
    }
  });

  it("co-failure boost is applied to allTests in plan", async () => {
    const plan = await planSample({
      store,
      count: 3,
      mode: "weighted",
      seed: 42,
      changedFiles: ["src/auth.ts"],
    });

    const loginTest = plan.allTests.find((t) => t.suite === "tests/login.spec.ts");
    expect(loginTest).toBeDefined();
    expect(loginTest!.co_failure_boost).toBe(100);

    const signupTest = plan.allTests.find((t) => t.suite === "tests/signup.spec.ts");
    expect(signupTest).toBeDefined();
    expect(signupTest!.co_failure_boost).toBe(0);
  });
});
