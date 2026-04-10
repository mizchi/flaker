import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { WorkflowRun, TestResult } from "../../src/cli/storage/types.js";
import {
  runQuarantine,
  formatQuarantineTable,
} from "../../src/cli/commands/policy/quarantine.js";

describe("quarantine command", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("adds a test to quarantine", async () => {
    await runQuarantine({
      store,
      action: "add",
      suite: "suite-a",
      testName: "test-1",
      reason: "manual",
    });
    const all = await store.queryQuarantined();
    expect(all).toHaveLength(1);
    expect(all[0].suite).toBe("suite-a");
    expect(all[0].testName).toBe("test-1");
  });

  it("removes a test from quarantine", async () => {
    await store.addQuarantine({ suite: "suite-a", testName: "test-1" }, "manual");
    await runQuarantine({
      store,
      action: "remove",
      suite: "suite-a",
      testName: "test-1",
    });
    const all = await store.queryQuarantined();
    expect(all).toHaveLength(0);
  });

  it("lists quarantined tests", async () => {
    await store.addQuarantine({ suite: "suite-a", testName: "test-1" }, "flaky");
    await store.addQuarantine({ suite: "suite-b", testName: "test-2" }, "manual");
    const result = await runQuarantine({ store, action: "list" });
    expect(result).toHaveLength(2);
    const table = formatQuarantineTable(result!);
    expect(table).toContain("suite-a");
    expect(table).toContain("test-1");
    expect(table).toContain("suite-b");
    expect(table).toContain("test-2");
  });

  it("auto-quarantines based on flaky threshold", async () => {
    // Seed a workflow run
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

    // Seed 20 test results: 8 failed, 12 passed → 40% flaky rate
    const results: TestResult[] = [];
    for (let i = 0; i < 20; i++) {
      results.push({
        workflowRunId: 1,
        suite: "suite-a",
        testName: "unstable-test",
        status: i < 8 ? "failed" : "passed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: i < 8 ? "flaky failure" : null,
        commitSha: "abc123",
        variant: null,
        createdAt: new Date(),
      });
    }
    await store.insertTestResults(results);

    // Auto quarantine with 30% threshold
    await runQuarantine({
      store,
      action: "auto",
      flakyRateThreshold: 30,
      minRuns: 5,
    });

    const quarantined = await store.queryQuarantined();
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0].suite).toBe("suite-a");
    expect(quarantined[0].testName).toBe("unstable-test");
    expect(quarantined[0].reason).toBe("auto:flaky_rate>=30%");
  });
});
