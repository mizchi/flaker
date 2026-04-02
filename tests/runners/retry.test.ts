import { describe, it, expect } from "vitest";
import type { RunnerAdapter, TestId, ExecuteResult } from "../../src/cli/runners/types.js";
import type { TestCaseResult } from "../../src/cli/adapters/types.js";
import { executeWithRetry } from "../../src/cli/runners/retry.js";
import { withQuarantineRuntime } from "../../src/cli/runners/quarantine-runtime.js";
import type { QuarantineManifestEntry } from "../../src/cli/quarantine-manifest.js";

function createMockRunner(resultSequence: ExecuteResult[]): RunnerAdapter {
  let callIndex = 0;
  return {
    name: "mock",
    capabilities: { nativeParallel: false },
    async execute(tests, opts) {
      const result = resultSequence[Math.min(callIndex, resultSequence.length - 1)];
      callIndex++;
      return result;
    },
    async listTests() { return []; },
  };
}

function makeResult(
  testResults: Array<{
    suite: string;
    testName: string;
    status: "passed" | "failed";
    filter?: string;
  }>,
): ExecuteResult {
  return {
    exitCode: testResults.some(r => r.status === "failed") ? 1 : 0,
    results: testResults.map(r => ({
      suite: r.suite,
      testName: r.testName,
      filter: r.filter,
      status: r.status,
      durationMs: 100,
      retryCount: 0,
    })),
    durationMs: 100,
    stdout: "",
    stderr: "",
  };
}

describe("executeWithRetry", () => {
  it("no retry needed when all pass", async () => {
    const runner = createMockRunner([
      makeResult([{ suite: "a", testName: "t1", status: "passed" }]),
    ]);
    const result = await executeWithRetry(runner, [{ suite: "a", testName: "t1" }], {
      maxRetries: 3, retryFailedOnly: true,
    });
    expect(result.totalAttempts).toBe(1);
    expect(result.retriedTests).toBe(0);
    expect(result.flakyDetected).toHaveLength(0);
  });

  it("detects flaky: fails then passes on retry", async () => {
    const runner = createMockRunner([
      makeResult([{ suite: "a", testName: "t1", status: "failed" }]),
      makeResult([{ suite: "a", testName: "t1", status: "passed" }]),
    ]);
    const result = await executeWithRetry(runner, [{ suite: "a", testName: "t1" }], {
      maxRetries: 3, retryFailedOnly: true,
    });
    expect(result.totalAttempts).toBe(2);
    expect(result.flakyDetected).toHaveLength(1);
    expect(result.flakyDetected[0]).toMatchObject({ suite: "a", testName: "t1" });
    expect(result.results[0].status).toBe("flaky");
    expect(result.results[0].retryCount).toBe(1);
    expect(result.exitCode).toBe(0);
  });

  it("marks as failed after all retries exhausted", async () => {
    const runner = createMockRunner([
      makeResult([{ suite: "a", testName: "t1", status: "failed" }]),
      makeResult([{ suite: "a", testName: "t1", status: "failed" }]),
      makeResult([{ suite: "a", testName: "t1", status: "failed" }]),
    ]);
    const result = await executeWithRetry(runner, [{ suite: "a", testName: "t1" }], {
      maxRetries: 2, retryFailedOnly: true,
    });
    expect(result.totalAttempts).toBe(3);
    expect(result.flakyDetected).toHaveLength(0);
    expect(result.results[0].status).toBe("failed");
    expect(result.exitCode).toBe(1);
  });

  it("retries only failed tests when retryFailedOnly=true", async () => {
    let executedTests: TestId[][] = [];
    const runner: RunnerAdapter = {
      name: "mock",
      capabilities: { nativeParallel: false },
      async execute(tests) {
        executedTests.push([...tests]);
        if (executedTests.length === 1) {
          // First run: t1 fails, t2 passes
          return makeResult([
            { suite: "a", testName: "t1", status: "failed" },
            { suite: "a", testName: "t2", status: "passed" },
          ]);
        }
        // Retry: only t1, and it passes
        return makeResult([{ suite: "a", testName: "t1", status: "passed" }]);
      },
      async listTests() { return []; },
    };

    const tests = [{ suite: "a", testName: "t1" }, { suite: "a", testName: "t2" }];
    const result = await executeWithRetry(runner, tests, {
      maxRetries: 2, retryFailedOnly: true,
    });

    // Second call should only have t1
    expect(executedTests[1]).toHaveLength(1);
    expect(executedTests[1][0].testName).toBe("t1");
    expect(result.flakyDetected).toHaveLength(1);
  });

  it("maxRetries=0 means no retry", async () => {
    const runner = createMockRunner([
      makeResult([{ suite: "a", testName: "t1", status: "failed" }]),
    ]);
    const result = await executeWithRetry(runner, [{ suite: "a", testName: "t1" }], {
      maxRetries: 0, retryFailedOnly: true,
    });
    expect(result.totalAttempts).toBe(1);
    expect(result.exitCode).toBe(1);
  });

  it("mixed results: some flaky, some truly failed", async () => {
    let callCount = 0;
    const runner: RunnerAdapter = {
      name: "mock",
      capabilities: { nativeParallel: false },
      async execute(tests) {
        callCount++;
        if (callCount === 1) {
          return makeResult([
            { suite: "a", testName: "flaky_test", status: "failed" },
            { suite: "a", testName: "broken_test", status: "failed" },
            { suite: "a", testName: "good_test", status: "passed" },
          ]);
        }
        // Retry: flaky passes, broken still fails
        return makeResult([
          { suite: "a", testName: "flaky_test", status: "passed" },
          { suite: "a", testName: "broken_test", status: "failed" },
        ]);
      },
      async listTests() { return []; },
    };

    const tests = [
      { suite: "a", testName: "flaky_test" },
      { suite: "a", testName: "broken_test" },
      { suite: "a", testName: "good_test" },
    ];
    const result = await executeWithRetry(runner, tests, {
      maxRetries: 1, retryFailedOnly: true,
    });

    expect(result.flakyDetected).toHaveLength(1);
    expect(result.flakyDetected[0].testName).toBe("flaky_test");

    const flaky = result.results.find(r => r.testName === "flaky_test")!;
    expect(flaky.status).toBe("flaky");

    const broken = result.results.find(r => r.testName === "broken_test")!;
    expect(broken.status).toBe("failed");

    const good = result.results.find(r => r.testName === "good_test")!;
    expect(good.status).toBe("passed");

    expect(result.exitCode).toBe(1); // broken_test still fails
  });

  it("keeps retries separate when suite/testName match but filters differ", async () => {
    let callCount = 0;
    const runner: RunnerAdapter = {
      name: "mock",
      capabilities: { nativeParallel: false },
      async execute() {
        callCount++;
        if (callCount === 1) {
          return makeResult([
            { suite: "a", testName: "shared_test", status: "failed", filter: "@smoke" },
            { suite: "a", testName: "shared_test", status: "passed", filter: "@regression" },
          ]);
        }
        return makeResult([
          { suite: "a", testName: "shared_test", status: "passed", filter: "@smoke" },
        ]);
      },
      async listTests() { return []; },
    };

    const tests = [
      { suite: "a", testName: "shared_test", filter: "@smoke" },
      { suite: "a", testName: "shared_test", filter: "@regression" },
    ];
    const result = await executeWithRetry(runner, tests, {
      maxRetries: 1, retryFailedOnly: true,
    });

    expect(result.flakyDetected).toHaveLength(1);
    expect(result.flakyDetected[0].filter).toBe("@smoke");
    expect(result.results).toHaveLength(2);
    expect(
      result.results.find(
        (r) => r.testName === "shared_test" && r.filter === "@regression",
      )?.status,
    ).toBe("passed");
    expect(
      result.results.find(
        (r) => r.testName === "shared_test" && r.filter === "@smoke",
      )?.status,
    ).toBe("flaky");
  });

  it("does not retry failed tests covered by allow_failure", async () => {
    let callCount = 0;
    const baseRunner: RunnerAdapter = {
      name: "mock",
      capabilities: { nativeParallel: false },
      async execute() {
        callCount++;
        return makeResult([
          {
            suite: "tests/known-bugs.spec.ts",
            testName: "fails on safari",
            status: "failed",
          },
        ]);
      },
      async listTests() { return []; },
    };
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

    const result = await executeWithRetry(
      runner,
      [{
        suite: "tests/known-bugs.spec.ts",
        testName: "fails on safari",
        taskId: "browser-e2e",
      }],
      {
        maxRetries: 3,
        retryFailedOnly: true,
      },
    );

    expect(callCount).toBe(1);
    expect(result.totalAttempts).toBe(1);
    expect(result.retriedTests).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(result.results[0].quarantine?.id).toBe("known-safari-bug");
  });

  it("preserves allow_flaky annotations when a retried test becomes flaky", async () => {
    let callCount = 0;
    const baseRunner: RunnerAdapter = {
      name: "mock",
      capabilities: { nativeParallel: false },
      async execute() {
        callCount++;
        if (callCount === 1) {
          return makeResult([
            {
              suite: "tests/flaky.spec.ts",
              testName: "sometimes times out",
              status: "failed",
            },
          ]);
        }
        return makeResult([
          {
            suite: "tests/flaky.spec.ts",
            testName: "sometimes times out",
            status: "passed",
          },
        ]);
      },
      async listTests() { return []; },
    };
    const entry: QuarantineManifestEntry = {
      id: "known-flake",
      taskId: "browser-e2e",
      spec: "tests/flaky.spec.ts",
      titlePattern: "^sometimes times out$",
      mode: "allow_flaky",
      scope: "flaky",
      owner: "@mizchi",
      reason: "network timing variance",
      condition: "sporadic CDN timeout",
      introducedAt: "2026-04-01",
      expiresAt: "2026-04-30",
    };
    const runner = withQuarantineRuntime(baseRunner, [entry]);

    const result = await executeWithRetry(
      runner,
      [{
        suite: "tests/flaky.spec.ts",
        testName: "sometimes times out",
        taskId: "browser-e2e",
      }],
      {
        maxRetries: 2,
        retryFailedOnly: true,
      },
    );

    expect(result.totalAttempts).toBe(2);
    expect(result.exitCode).toBe(0);
    expect(result.results[0].status).toBe("flaky");
    expect(result.results[0].quarantine?.id).toBe("known-flake");
  });
});
