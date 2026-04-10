import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DuckDBStore } from "../src/cli/storage/duckdb.js";
import { junitAdapter } from "../src/cli/adapters/junit.js";
import { runTrueFlaky } from "../src/cli/commands/analyze/flaky.js";
import { runFlakyByVariant } from "../src/cli/commands/analyze/flaky.js";

const fixtureXml = readFileSync(
  join(import.meta.dirname, "fixtures/junit-report.xml"),
  "utf-8",
);

describe("Phase 3 integration", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => { await store.close(); });

  it("parses JUnit XML fixture and stores in DB", async () => {
    const testCases = junitAdapter.parse(fixtureXml);
    expect(testCases).toHaveLength(5);

    await store.insertWorkflowRun({
      id: 1, repo: "test/repo", branch: "main", commitSha: "sha1",
      event: "push", status: "completed",
      createdAt: new Date(2026, 2, 1), durationMs: 60000,
    });

    const testResults = testCases.map((tc) => ({
      workflowRunId: 1,
      suite: tc.suite,
      testName: tc.testName,
      status: tc.status,
      durationMs: tc.durationMs,
      retryCount: tc.retryCount,
      errorMessage: tc.errorMessage ?? null,
      commitSha: "sha1",
      variant: tc.variant ?? null,
      createdAt: new Date(2026, 2, 1),
    }));

    await store.insertTestResults(testResults);

    const stored = await store.raw<{ cnt: number }>(
      "SELECT COUNT(*)::INTEGER AS cnt FROM test_results",
    );
    expect(stored[0].cnt).toBe(5);
  });

  it("detects true flaky tests (same commit, pass+fail)", async () => {
    // Create 3 workflow runs all on the same commit
    for (let i = 1; i <= 3; i++) {
      await store.insertWorkflowRun({
        id: i, repo: "test/repo", branch: "main", commitSha: "same-sha",
        event: "push", status: "completed",
        createdAt: new Date(2026, 2, i), durationMs: 60000,
      });
    }

    // Run 1: test passes; Run 2: test fails; Run 3: test passes
    // This is true flaky — same commit, different outcomes
    const statuses = ["passed", "failed", "passed"];
    for (let i = 0; i < 3; i++) {
      await store.insertTestResults([{
        workflowRunId: i + 1,
        suite: "tests/flaky.spec.ts",
        testName: "intermittent test",
        status: statuses[i],
        durationMs: 100,
        retryCount: 0,
        errorMessage: statuses[i] === "failed" ? "Random failure" : null,
        commitSha: "same-sha",
        variant: null,
        createdAt: new Date(2026, 2, i + 1),
      }]);
    }

    // A stable test for comparison (always passes)
    for (let i = 0; i < 3; i++) {
      await store.insertTestResults([{
        workflowRunId: i + 1,
        suite: "tests/stable.spec.ts",
        testName: "stable test",
        status: "passed",
        durationMs: 50,
        retryCount: 0,
        errorMessage: null,
        commitSha: "same-sha",
        variant: null,
        createdAt: new Date(2026, 2, i + 1),
      }]);
    }

    const trueFlaky = await runTrueFlaky({ store });
    expect(trueFlaky).toHaveLength(1);
    expect(trueFlaky[0].suite).toBe("tests/flaky.spec.ts");
    expect(trueFlaky[0].testName).toBe("intermittent test");
    expect(trueFlaky[0].flakyCommits).toBe(1);
    expect(trueFlaky[0].commitsTested).toBe(1);
    expect(trueFlaky[0].trueFlakyRate).toBe(100);
  });

  it("variant flaky analysis shows different rates per variant", async () => {
    await store.insertWorkflowRun({
      id: 1, repo: "test/repo", branch: "main", commitSha: "v-sha",
      event: "push", status: "completed",
      createdAt: new Date(2026, 2, 1), durationMs: 60000,
    });

    // Chromium: 4/10 fail (40%)
    for (let i = 0; i < 10; i++) {
      await store.insertTestResults([{
        workflowRunId: 1,
        suite: "tests/render.spec.ts",
        testName: "renders correctly",
        status: i < 4 ? "failed" : "passed",
        durationMs: 200,
        retryCount: 0,
        errorMessage: i < 4 ? "Layout shift" : null,
        commitSha: "v-sha",
        variant: { browser: "chromium" },
        createdAt: new Date(2026, 2, 1),
      }]);
    }

    // Firefox: 1/10 fail (10%)
    for (let i = 0; i < 10; i++) {
      await store.insertTestResults([{
        workflowRunId: 1,
        suite: "tests/render.spec.ts",
        testName: "renders correctly",
        status: i < 1 ? "failed" : "passed",
        durationMs: 200,
        retryCount: 0,
        errorMessage: i < 1 ? "Layout shift" : null,
        commitSha: "v-sha",
        variant: { browser: "firefox" },
        createdAt: new Date(2026, 2, 1),
      }]);
    }

    const results = await runFlakyByVariant({ store });
    expect(results).toHaveLength(2);

    const chromium = results.find((r) => r.variant.browser === "chromium");
    const firefox = results.find((r) => r.variant.browser === "firefox");

    expect(chromium!.flakyRate).toBe(40);
    expect(chromium!.failCount).toBe(4);
    expect(firefox!.flakyRate).toBe(10);
    expect(firefox!.failCount).toBe(1);

    // Chromium should come first (higher flaky rate, sorted DESC)
    expect(results[0].variant.browser).toBe("chromium");
  });
});
