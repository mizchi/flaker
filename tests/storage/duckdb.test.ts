import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type {
  WorkflowRun,
  TestResult,
} from "../../src/cli/storage/types.js";
import { createStableTestId } from "../../src/cli/identity.js";

describe("DuckDBStore", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("initializes schema (tables exist)", async () => {
    const tables = await store.raw<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'main'
       ORDER BY table_name`
    );
    const names = tables.map((r) => r.table_name);
    expect(names).toContain("test_results");
    expect(names).toContain("workflow_runs");
  });

  it("inserts and retrieves a workflow run", async () => {
    const run: WorkflowRun = {
      id: 100,
      repo: "owner/repo",
      branch: "main",
      commitSha: "abc123",
      event: "push",
      status: "completed",
      createdAt: new Date("2025-01-01T00:00:00Z"),
      durationMs: 5000,
    };
    await store.insertWorkflowRun(run);

    const rows = await store.raw<WorkflowRun>(
      "SELECT * FROM workflow_runs WHERE id = ?",
      [100]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].repo).toBe("owner/repo");
    expect(rows[0].commit_sha ?? rows[0].commitSha).toBe("abc123");
  });

  it("inserts test results in batch", async () => {
    const run: WorkflowRun = {
      id: 200,
      repo: "owner/repo",
      branch: "main",
      commitSha: "def456",
      event: "push",
      status: "completed",
      createdAt: new Date("2025-01-01T00:00:00Z"),
      durationMs: 3000,
    };
    await store.insertWorkflowRun(run);

    const results: TestResult[] = [
      {
        workflowRunId: 200,
        suite: "unit",
        testName: "test-a",
        status: "passed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: null,
        commitSha: "def456",
        variant: null,
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
      {
        workflowRunId: 200,
        suite: "unit",
        testName: "test-b",
        status: "failed",
        durationMs: 200,
        retryCount: 0,
        errorMessage: "assertion error",
        commitSha: "def456",
        variant: { os: "linux" },
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];
    await store.insertTestResults(results);

    const rows = await store.raw<{ count: number }>(
      "SELECT COUNT(*)::INTEGER AS count FROM test_results"
    );
    expect(rows[0].count).toBe(2);
  });

  it("queries flaky tests", async () => {
    // Seed workflow run
    const run: WorkflowRun = {
      id: 300,
      repo: "owner/repo",
      branch: "main",
      commitSha: "ghi789",
      event: "push",
      status: "completed",
      createdAt: new Date(),
      durationMs: 1000,
    };
    await store.insertWorkflowRun(run);

    // Seed 10 test results: 3 failed, 2 flaky retry passed, 5 passed
    const now = new Date();
    const results: TestResult[] = [];
    for (let i = 0; i < 10; i++) {
      let status: string;
      let retryCount: number;
      let errorMessage: string | null = null;
      if (i < 3) {
        status = "failed";
        retryCount = 0;
        errorMessage = "flaky failure";
      } else if (i < 5) {
        status = "passed";
        retryCount = 1; // flaky retry
      } else {
        status = "passed";
        retryCount = 0;
      }
      results.push({
        workflowRunId: 300,
        suite: "integration",
        testName: "flaky-test",
        status,
        durationMs: 100,
        retryCount,
        errorMessage,
        commitSha: "ghi789",
        variant: null,
        createdAt: now,
      });
    }
    await store.insertTestResults(results);

    const flaky = await store.queryFlakyTests({ windowDays: 30 });
    expect(flaky).toHaveLength(1);
    expect(flaky[0].suite).toBe("integration");
    expect(flaky[0].testName).toBe("flaky-test");
    expect(flaky[0].totalRuns).toBe(10);
    expect(flaky[0].failCount).toBe(3);
    expect(flaky[0].flakyRetryCount).toBe(2);
    expect(flaky[0].flakyRate).toBe(50.0);
  });

  it("keeps same suite/testName separate when filter differs", async () => {
    const run: WorkflowRun = {
      id: 301,
      repo: "owner/repo",
      branch: "main",
      commitSha: "split123",
      event: "push",
      status: "completed",
      createdAt: new Date(),
      durationMs: 1000,
    };
    await store.insertWorkflowRun(run);

    const now = new Date();
    const results: TestResult[] = [];
    for (let i = 0; i < 5; i++) {
      results.push({
        workflowRunId: 301,
        suite: "integration",
        testName: "shared-test",
        filter: "@smoke",
        status: "failed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: "flaky failure",
        commitSha: "split123",
        variant: null,
        createdAt: now,
      });
      results.push({
        workflowRunId: 301,
        suite: "integration",
        testName: "shared-test",
        filter: "@regression",
        status: "passed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: null,
        commitSha: "split123",
        variant: null,
        createdAt: now,
      });
    }
    await store.insertTestResults(results);

    const flaky = await store.queryFlakyTests({ windowDays: 30 });
    expect(flaky).toHaveLength(1);
    expect(flaky[0].suite).toBe("integration");
    expect(flaky[0].testName).toBe("shared-test");
    expect(flaky[0].filter).toBe("@smoke");
    expect(flaky[0].testId).toBe(
      createStableTestId({
        suite: "integration",
        testName: "shared-test",
        filter: "@smoke",
      }),
    );
  });

  it("queries test history", async () => {
    const run: WorkflowRun = {
      id: 400,
      repo: "owner/repo",
      branch: "main",
      commitSha: "jkl012",
      event: "push",
      status: "completed",
      createdAt: new Date(),
      durationMs: 1000,
    };
    await store.insertWorkflowRun(run);

    const results: TestResult[] = [
      {
        workflowRunId: 400,
        suite: "e2e",
        testName: "login-test",
        status: "passed",
        durationMs: 500,
        retryCount: 0,
        errorMessage: null,
        commitSha: "jkl012",
        variant: null,
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
      {
        workflowRunId: 400,
        suite: "e2e",
        testName: "login-test",
        status: "failed",
        durationMs: 600,
        retryCount: 0,
        errorMessage: "timeout",
        commitSha: "jkl012",
        variant: null,
        createdAt: new Date("2025-01-02T00:00:00Z"),
      },
    ];
    await store.insertTestResults(results);

    const history = await store.queryTestHistory("e2e", "login-test");
    expect(history).toHaveLength(2);
    expect(history[0].suite).toBe("e2e");
    expect(history[0].testName).toBe("login-test");
  });

  it("persists quarantine metadata with stored test results", async () => {
    const run: WorkflowRun = {
      id: 401,
      repo: "owner/repo",
      branch: "main",
      commitSha: "quarantine123",
      event: "push",
      status: "completed",
      createdAt: new Date(),
      durationMs: 1000,
    };
    await store.insertWorkflowRun(run);

    await store.insertTestResults([
      {
        workflowRunId: 401,
        suite: "e2e",
        testName: "known broken flow",
        status: "failed",
        durationMs: 200,
        retryCount: 0,
        errorMessage: "AssertionError",
        commitSha: "quarantine123",
        variant: null,
        quarantine: {
          id: "known-bug",
          taskId: "browser-e2e",
          spec: "tests/known-bugs.spec.ts",
          titlePattern: "^known broken flow$",
          mode: "allow_failure",
          scope: "expected_failure",
          owner: "@mizchi",
          reason: "known browser issue",
          condition: "waiting for upstream fix",
          introducedAt: "2026-04-01",
          expiresAt: "2026-04-30",
        },
        createdAt: new Date("2025-01-03T00:00:00Z"),
      },
    ]);

    const history = await store.queryTestHistory("e2e", "known broken flow");
    expect(history[0].quarantine).toMatchObject({
      id: "known-bug",
      mode: "allow_failure",
      owner: "@mizchi",
    });
  });

  it("executes raw SQL", async () => {
    const rows = await store.raw<{ answer: number }>("SELECT 42 AS answer");
    expect(rows).toHaveLength(1);
    expect(rows[0].answer).toBe(42);
  });
});
