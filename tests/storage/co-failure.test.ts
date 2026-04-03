import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";

describe("co-failure query", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();

    // Create 3 workflow runs with different commits
    for (let i = 1; i <= 3; i++) {
      await store.insertWorkflowRun({
        id: i,
        repo: "test/repo",
        branch: "main",
        commitSha: `sha${i}`,
        event: "push",
        status: "completed",
        createdAt: new Date(Date.now() - (4 - i) * 86400000),
        durationMs: 60000,
      });
    }

    // sha1: changed src/auth.ts -> test-login failed
    await store.insertCommitChanges("sha1", [
      { filePath: "src/auth.ts", changeType: "modified", additions: 5, deletions: 2 },
    ]);
    await store.insertTestResults([
      {
        workflowRunId: 1, suite: "tests/login.spec.ts", testName: "login works",
        status: "failed", durationMs: 100, retryCount: 0, errorMessage: "err",
        commitSha: "sha1", variant: null, createdAt: new Date(Date.now() - 3 * 86400000),
      },
      {
        workflowRunId: 1, suite: "tests/signup.spec.ts", testName: "signup works",
        status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
        commitSha: "sha1", variant: null, createdAt: new Date(Date.now() - 3 * 86400000),
      },
    ]);

    // sha2: changed src/auth.ts again -> test-login failed again
    await store.insertCommitChanges("sha2", [
      { filePath: "src/auth.ts", changeType: "modified", additions: 3, deletions: 1 },
    ]);
    await store.insertTestResults([
      {
        workflowRunId: 2, suite: "tests/login.spec.ts", testName: "login works",
        status: "failed", durationMs: 100, retryCount: 0, errorMessage: "err",
        commitSha: "sha2", variant: null, createdAt: new Date(Date.now() - 2 * 86400000),
      },
      {
        workflowRunId: 2, suite: "tests/signup.spec.ts", testName: "signup works",
        status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
        commitSha: "sha2", variant: null, createdAt: new Date(Date.now() - 2 * 86400000),
      },
    ]);

    // sha3: changed src/ui.ts -> everything passed
    await store.insertCommitChanges("sha3", [
      { filePath: "src/ui.ts", changeType: "modified", additions: 10, deletions: 0 },
    ]);
    await store.insertTestResults([
      {
        workflowRunId: 3, suite: "tests/login.spec.ts", testName: "login works",
        status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
        commitSha: "sha3", variant: null, createdAt: new Date(Date.now() - 86400000),
      },
      {
        workflowRunId: 3, suite: "tests/signup.spec.ts", testName: "signup works",
        status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
        commitSha: "sha3", variant: null, createdAt: new Date(Date.now() - 86400000),
      },
    ]);
  });

  afterEach(async () => {
    await store.close();
  });

  it("computes co-failure rates", async () => {
    const results = await store.queryCoFailures({ windowDays: 90, minCoRuns: 2 });
    // src/auth.ts + login: 2 co-runs, 2 failures = 100%
    const authLogin = results.find(
      (r) => r.filePath === "src/auth.ts" && r.suite === "tests/login.spec.ts",
    );
    expect(authLogin).toBeDefined();
    expect(authLogin!.coFailureRate).toBe(100);
    expect(authLogin!.coRuns).toBe(2);
    expect(authLogin!.coFailures).toBe(2);

    // src/auth.ts + signup: 2 co-runs, 0 failures — should not appear (co_failures = 0)
    const authSignup = results.find(
      (r) => r.filePath === "src/auth.ts" && r.suite === "tests/signup.spec.ts",
    );
    expect(authSignup).toBeUndefined();
  });

  it("respects minCoRuns filter", async () => {
    const results = await store.queryCoFailures({ windowDays: 90, minCoRuns: 3 });
    expect(results).toHaveLength(0);
  });

  it("getCoFailureBoosts returns boost for changed files", async () => {
    const boosts = await store.getCoFailureBoosts(
      ["src/auth.ts"],
      { windowDays: 90, minCoRuns: 2 },
    );
    expect(boosts.size).toBeGreaterThan(0);
    // login test should have boost of 100 (100% co-failure rate)
    const loginBoost = [...boosts.values()].find((v) => v > 0);
    expect(loginBoost).toBe(100);
  });

  it("getCoFailureBoosts returns empty for unrelated files", async () => {
    const boosts = await store.getCoFailureBoosts(
      ["src/unrelated.ts"],
      { windowDays: 90, minCoRuns: 2 },
    );
    expect(boosts.size).toBe(0);
  });
});
