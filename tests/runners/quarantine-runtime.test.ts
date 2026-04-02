import { describe, it, expect } from "vitest";
import type {
  RunnerAdapter,
  ExecuteResult,
  TestId,
} from "../../src/cli/runners/types.js";
import type { QuarantineManifestEntry } from "../../src/cli/quarantine-manifest.js";
import { withQuarantineRuntime } from "../../src/cli/runners/quarantine-runtime.js";

function makeRunner(
  executeImpl: (tests: TestId[]) => Promise<ExecuteResult>,
): RunnerAdapter & { calls: TestId[][] } {
  const calls: TestId[][] = [];
  return {
    name: "mock",
    capabilities: { nativeParallel: false },
    calls,
    async execute(tests) {
      calls.push([...tests]);
      return executeImpl(tests);
    },
    async listTests() {
      return [];
    },
  };
}

describe("withQuarantineRuntime", () => {
  it("skips matched tests before execution and annotates the synthetic result", async () => {
    const baseRunner = makeRunner(async (tests) => ({
      exitCode: 0,
      results: tests.map((test) => ({
        suite: test.suite,
        testName: test.testName,
        taskId: test.taskId,
        status: "passed",
        durationMs: 100,
        retryCount: 0,
      })),
      durationMs: 100,
      stdout: "ok",
      stderr: "",
    }));

    const entry: QuarantineManifestEntry = {
      id: "paint-vrt-local-assets",
      taskId: "paint-vrt",
      spec: "tests/paint-vrt.spec.ts",
      titlePattern: "^optional snapshot asset$",
      mode: "skip",
      scope: "environment",
      owner: "@mizchi",
      reason: "optional asset is absent on local runs",
      condition: "missing local snapshot asset",
      introducedAt: "2026-04-01",
      expiresAt: "2026-04-30",
    };

    const runner = withQuarantineRuntime(baseRunner, [entry]);
    const result = await runner.execute([
      {
        suite: "tests/paint-vrt.spec.ts",
        testName: "optional snapshot asset",
        taskId: "paint-vrt",
      },
      {
        suite: "tests/paint-vrt.spec.ts",
        testName: "renders baseline",
        taskId: "paint-vrt",
      },
    ]);

    expect(baseRunner.calls).toEqual([
      [
        {
          suite: "tests/paint-vrt.spec.ts",
          testName: "renders baseline",
          taskId: "paint-vrt",
        },
      ],
    ]);
    expect(
      result.results.find(
        (row) => row.testName === "optional snapshot asset",
      ),
    ).toMatchObject({
      status: "skipped",
      quarantine: {
        id: "paint-vrt-local-assets",
        mode: "skip",
        owner: "@mizchi",
      },
    });
    expect(
      result.results.find(
        (row) => row.testName === "optional snapshot asset",
      )?.errorMessage,
    ).toContain("paint-vrt-local-assets");
  });

  it("annotates allow_failure results and removes them from the blocking exit code", async () => {
    const baseRunner = makeRunner(async () => ({
      exitCode: 1,
      results: [
        {
          suite: "tests/known-bugs.spec.ts",
          testName: "fails on safari",
          taskId: "browser-e2e",
          status: "failed",
          durationMs: 100,
          retryCount: 0,
          errorMessage: "AssertionError",
        },
      ],
      durationMs: 100,
      stdout: "",
      stderr: "failed",
    }));

    const entry: QuarantineManifestEntry = {
      id: "known-safari-bug",
      taskId: "browser-e2e",
      spec: "tests/known-bugs.spec.ts",
      titlePattern: "^fails on safari$",
      mode: "allow_failure",
      scope: "expected_failure",
      owner: "@mizchi",
      reason: "upstream browser bug",
      condition: "Safari 18 canvas regression",
      introducedAt: "2026-04-01",
      expiresAt: "2026-04-30",
    };

    const runner = withQuarantineRuntime(baseRunner, [entry]);
    const result = await runner.execute([
      {
        suite: "tests/known-bugs.spec.ts",
        testName: "fails on safari",
        taskId: "browser-e2e",
      },
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.results[0]).toMatchObject({
      status: "failed",
      quarantine: {
        id: "known-safari-bug",
        mode: "allow_failure",
      },
    });
    expect(result.results[0].errorMessage).toContain("known-safari-bug");
  });
});
