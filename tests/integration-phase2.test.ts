import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../src/cli/storage/duckdb.js";
import { runQuarantine } from "../src/cli/commands/policy/quarantine.js";
import { runBisect } from "../src/cli/commands/debug/bisect.js";
import { runSample } from "../src/cli/commands/exec/plan.js";
import { SimpleResolver } from "../src/cli/resolvers/simple.js";

describe("Phase 2 integration", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
    for (let i = 0; i < 5; i++) {
      await store.insertWorkflowRun({
        id: i + 1, repo: "test/repo", branch: "main", commitSha: `sha${i + 1}`,
        event: "push", status: "completed",
        createdAt: new Date(Date.now() - (5 - i) * 86400000), durationMs: 60000,
      });
    }
    for (let run = 0; run < 5; run++) {
      for (let t = 0; t < 10; t++) {
        const isFlaky = t < 2;
        const isFailing = isFlaky && run >= 2;
        await store.insertTestResults([{
          workflowRunId: run + 1, suite: `tests/module_${t}/test.spec.ts`, testName: `test_${t}`,
          status: isFailing ? "failed" : "passed",
          durationMs: 100, retryCount: 0, errorMessage: isFailing ? "Timeout" : null,
          commitSha: `sha${run + 1}`, variant: null, createdAt: new Date(Date.now() - (5 - run) * 86400000),
        }]);
      }
    }
  });

  afterEach(async () => { await store.close(); });

  it("auto-quarantine identifies flaky tests", async () => {
    await runQuarantine({ store, action: "auto", flakyRateThreshold: 30.0, minRuns: 3, windowDays: 30 });
    const q = await store.queryQuarantined();
    expect(q.length).toBeGreaterThanOrEqual(1);
    expect(q.map((x) => x.suite)).toContain("tests/module_0/test.spec.ts");
  });

  it("bisect finds transition for flaky test", async () => {
    const result = await runBisect({ store, suite: "tests/module_0/test.spec.ts", testName: "test_0" });
    expect(result).not.toBeNull();
    expect(result!.lastGoodCommit).toBe("sha2");
    expect(result!.firstBadCommit).toBe("sha3");
  });

  it("hybrid sample with skip-quarantined", async () => {
    await store.addQuarantine(
      { suite: "tests/module_0/test.spec.ts", testName: "test_0" },
      "auto",
    );
    const resolver = new SimpleResolver();
    const result = await runSample({
      store, mode: "hybrid", count: 5,
      resolver, changedFiles: ["src/module_3/foo.ts"],
      skipQuarantined: true,
    });
    const suites = result.map((r) => r.suite);
    expect(suites).not.toContain("tests/module_0/test.spec.ts");
    expect(suites).toContain("tests/module_3/test.spec.ts");
  });
});
