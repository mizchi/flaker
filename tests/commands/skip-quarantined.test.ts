import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runSample } from "../../src/cli/commands/exec/plan.js";
import type { QuarantineManifestEntry } from "../../src/cli/quarantine-manifest.js";

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
    await store.addQuarantine(
      { suite: "tests/test_0.spec.ts", testName: "test_0" },
      "manual",
    );
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

  it("excludes repo-tracked skip entries but keeps non-skip modes", async () => {
    const manifestEntries: QuarantineManifestEntry[] = [
      {
        id: "skip-test-1",
        taskId: "tests/test_1.spec.ts",
        spec: "tests/test_1.spec.ts",
        titlePattern: "^test_1$",
        mode: "skip",
        scope: "environment",
        owner: "@mizchi",
        reason: "local-only asset",
        condition: "asset not installed",
        introducedAt: "2026-04-01",
        expiresAt: "2026-04-30",
      },
      {
        id: "allow-failure-test-2",
        taskId: "tests/test_2.spec.ts",
        spec: "tests/test_2.spec.ts",
        titlePattern: "^test_2$",
        mode: "allow_failure",
        scope: "expected_failure",
        owner: "@mizchi",
        reason: "known bug",
        condition: "waiting for fix",
        introducedAt: "2026-04-01",
        expiresAt: "2026-04-30",
      },
    ];

    const result = await runSample({
      store,
      mode: "random",
      count: 10,
      skipQuarantined: true,
      quarantineManifestEntries: manifestEntries,
    });
    const suites = result.map((r) => r.suite);
    expect(suites).not.toContain("tests/test_0.spec.ts");
    expect(suites).not.toContain("tests/test_1.spec.ts");
    expect(suites).toContain("tests/test_2.spec.ts");
    expect(result.length).toBe(3);
  });

  it("uses listed task ids when matching manifest skip entries", async () => {
    const manifestEntries: QuarantineManifestEntry[] = [
      {
        id: "paint-vrt-local-assets",
        taskId: "paint-vrt",
        spec: "tests/test_1.spec.ts",
        titlePattern: "^test_1$",
        mode: "skip",
        scope: "environment",
        owner: "@mizchi",
        reason: "local-only asset",
        condition: "asset not installed",
        introducedAt: "2026-04-01",
        expiresAt: "2026-04-30",
      },
    ];

    const result = await runSample({
      store,
      mode: "random",
      count: 10,
      skipQuarantined: true,
      quarantineManifestEntries: manifestEntries,
      listedTests: [
        {
          suite: "tests/test_1.spec.ts",
          testName: "test_1",
          taskId: "paint-vrt",
        },
      ],
    });

    const suites = result.map((r) => r.suite);
    expect(suites).not.toContain("tests/test_1.spec.ts");
  });
});
