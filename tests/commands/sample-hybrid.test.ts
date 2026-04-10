import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runSample } from "../../src/cli/commands/exec/plan.js";
import { SimpleResolver } from "../../src/cli/resolvers/simple.js";

describe("hybrid sampling", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
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
    // 10 tests, first 2 are flaky
    for (let t = 0; t < 10; t++) {
      for (let r = 0; r < 10; r++) {
        await store.insertTestResults([
          {
            workflowRunId: 1,
            suite: `tests/module_${t}/test.spec.ts`,
            testName: `test_${t}`,
            status: t < 2 && r < 4 ? "failed" : "passed",
            durationMs: 100,
            retryCount: 0,
            errorMessage: null,
            commitSha: "abc",
            variant: null,
            createdAt: new Date(),
          },
        ]);
      }
    }
  });

  afterEach(async () => {
    await store.close();
  });

  it("hybrid includes affected tests", async () => {
    const resolver = new SimpleResolver();
    const result = await runSample({
      store,
      mode: "hybrid",
      count: 5,
      resolver,
      changedFiles: ["src/module_3/foo.ts"],
    });
    const suites = result.map((r) => r.suite);
    expect(suites).toContain("tests/module_3/test.spec.ts");
  });

  it("affected mode returns only affected tests", async () => {
    const resolver = new SimpleResolver();
    const result = await runSample({
      store,
      mode: "affected",
      resolver,
      changedFiles: ["src/module_5/bar.ts"],
    });
    expect(result.length).toBe(1);
    expect(result[0].suite).toBe("tests/module_5/test.spec.ts");
  });
});
