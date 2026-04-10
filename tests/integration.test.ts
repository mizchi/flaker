import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DuckDBStore } from "../src/cli/storage/duckdb.js";
import { playwrightAdapter } from "../src/cli/adapters/playwright.js";
import { runFlaky } from "../src/cli/commands/analyze/flaky.js";
import { runSample } from "../src/cli/commands/exec/plan.js";
import { runQuery } from "../src/cli/commands/analyze/query.js";
import type { WorkflowRun, TestResult } from "../src/cli/storage/types.js";
import type { TestCaseResult } from "../src/cli/adapters/types.js";

describe("integration: parse → store → flaky → sample → query", () => {
  let store: DuckDBStore;
  let parsed: TestCaseResult[];

  beforeEach(async () => {
    // Step 1: Parse fixture with playwright adapter
    const fixturePath = join(import.meta.dirname, "fixtures/playwright-report.json");
    const json = readFileSync(fixturePath, "utf-8");
    parsed = playwrightAdapter.parse(json);
    expect(parsed).toHaveLength(4);

    // Step 2: Create in-memory DuckDB store
    store = new DuckDBStore(":memory:");
    await store.initialize();

    // Step 3: Insert 5 workflow runs, each containing the parsed test results
    // For "should redirect after login": odd runs = passed, even runs = failed
    for (let runId = 1; runId <= 5; runId++) {
      const run: WorkflowRun = {
        id: runId,
        repo: "owner/repo",
        branch: "main",
        commitSha: `sha-${runId}`,
        event: "push",
        status: "success",
        createdAt: new Date(),
        durationMs: 60000,
      };
      await store.insertWorkflowRun(run);

      const results: TestResult[] = parsed.map((tc) => {
        let status = tc.status;

        // Alternate flaky test status: odd runs = passed, even runs = failed
        if (tc.testName === "should redirect after login") {
          status = runId % 2 === 1 ? "passed" : "failed";
        }

        return {
          workflowRunId: runId,
          suite: tc.suite,
          testName: tc.testName,
          status,
          durationMs: tc.durationMs,
          retryCount: tc.retryCount,
          errorMessage: tc.errorMessage ?? null,
          commitSha: `sha-${runId}`,
          variant: tc.variant ?? null,
          createdAt: new Date(),
        };
      });

      await store.insertTestResults(results);
    }
  });

  afterEach(async () => {
    await store.close();
  });

  it("runFlaky finds the flaky test", async () => {
    const flaky = await runFlaky({ store });
    expect(flaky.length).toBeGreaterThan(0);

    const flakyNames = flaky.map((f) => f.testName);
    expect(flakyNames).toContain("should redirect after login");
  });

  it("runSample with weighted strategy returns results with suite/testName", async () => {
    const sampled = await runSample({
      store,
      mode: "weighted",
      count: 2,
      seed: 42,
    });
    expect(sampled).toHaveLength(2);
    for (const item of sampled) {
      expect(item.suite).toBeDefined();
      expect(item.test_name).toBeDefined();
    }
  });

  it("runQuery returns correct total count (4 tests × 5 runs = 20)", async () => {
    const rows = await runQuery(store, "SELECT COUNT(*)::INTEGER AS cnt FROM test_results");
    expect(rows).toHaveLength(1);
    expect((rows[0] as { cnt: number }).cnt).toBe(20);
  });
});
