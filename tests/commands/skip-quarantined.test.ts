import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runSample } from "../../src/cli/commands/sample.js";

describe("--skip-quarantined", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
    await store.insertWorkflowRun({
      id: 1, repo: "test/repo", branch: "main", commitSha: "abc",
      event: "push", status: "completed", createdAt: new Date(), durationMs: 1000,
    });
    for (let t = 0; t < 5; t++) {
      for (let r = 0; r < 10; r++) {
        await store.insertTestResults([{
          workflowRunId: 1, suite: `tests/test_${t}.spec.ts`, testName: `test_${t}`,
          status: t === 0 && r < 5 ? "failed" : "passed",
          durationMs: 100, retryCount: 0, errorMessage: null,
          commitSha: "abc", variant: null, createdAt: new Date(),
        }]);
      }
    }
    await store.addQuarantine("tests/test_0.spec.ts", "test_0", "manual");
  });

  afterEach(async () => { await store.close(); });

  it("excludes quarantined tests when skipQuarantined=true", async () => {
    const result = await runSample({ store, mode: "random", count: 10, skipQuarantined: true });
    const suites = result.map((r) => r.suite);
    expect(suites).not.toContain("tests/test_0.spec.ts");
    expect(result.length).toBe(4);
  });

  it("includes quarantined tests by default", async () => {
    const result = await runSample({ store, mode: "random", count: 10 });
    const suites = result.map((r) => r.suite);
    expect(suites).toContain("tests/test_0.spec.ts");
    expect(result.length).toBe(5);
  });
});
