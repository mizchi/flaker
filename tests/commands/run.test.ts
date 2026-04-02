import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runTests } from "../../src/cli/commands/run.js";
import type { RunnerAdapter, TestId } from "../../src/cli/runners/types.js";
import type { QuarantineManifestEntry } from "../../src/cli/quarantine-manifest.js";

describe("run command", () => {
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
    await store.insertTestResults([
      {
        workflowRunId: 1,
        suite: "tests/paint-vrt.spec.ts",
        testName: "optional snapshot asset",
        status: "passed",
        durationMs: 100,
        retryCount: 0,
        errorMessage: null,
        commitSha: "abc",
        variant: null,
        createdAt: new Date(),
      },
    ]);
  });

  afterEach(async () => {
    await store.close();
  });

  it("enriches sampled tests via listTests and applies runtime quarantine", async () => {
    const calls: TestId[][] = [];
    const runner: RunnerAdapter = {
      name: "mock",
      capabilities: { nativeParallel: false },
      async listTests() {
        return [
          {
            suite: "tests/paint-vrt.spec.ts",
            testName: "optional snapshot asset",
            taskId: "paint-vrt",
          },
        ];
      },
      async execute(tests) {
        calls.push([...tests]);
        return {
          exitCode: 0,
          results: tests.map((test) => ({
            suite: test.suite,
            testName: test.testName,
            taskId: test.taskId,
            status: "passed",
            durationMs: 10,
            retryCount: 0,
          })),
          durationMs: 10,
          stdout: "",
          stderr: "",
        };
      },
    };
    const manifestEntries: QuarantineManifestEntry[] = [
      {
        id: "paint-vrt-local-assets",
        taskId: "paint-vrt",
        spec: "tests/paint-vrt.spec.ts",
        titlePattern: "^optional snapshot asset$",
        mode: "skip",
        scope: "environment",
        owner: "@mizchi",
        reason: "local-only asset",
        condition: "asset not installed",
        introducedAt: "2026-04-01",
        expiresAt: "2026-04-30",
      },
    ];

    const result = await runTests({
      store,
      runner,
      mode: "random",
      count: 1,
      quarantineManifestEntries: manifestEntries,
    });

    expect(calls).toHaveLength(0);
    expect(result.exitCode).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      suite: "tests/paint-vrt.spec.ts",
      testName: "optional snapshot asset",
      status: "skipped",
      quarantine: {
        id: "paint-vrt-local-assets",
      },
    });
  });
});
