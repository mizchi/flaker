import { describe, it, expect, vi } from "vitest";
import { runConfirmLocal } from "../../src/cli/commands/debug/confirm-local.js";
import type { RunnerAdapter, ExecuteResult } from "../../src/cli/runners/types.js";

function createMockRunner(results: Array<"pass" | "fail">): RunnerAdapter {
  let call = 0;
  return {
    name: "mock",
    capabilities: { nativeParallel: false },
    execute: vi.fn(async () => {
      const status = results[call++] ?? "pass";
      const exitCode = status === "fail" ? 1 : 0;
      return {
        exitCode,
        results: [{
          testId: "t1",
          suite: "tests/api.test.ts",
          testName: "handles timeout",
          status: status === "fail" ? "failed" : "passed",
          durationMs: 100,
          retryCount: 0,
        }],
        durationMs: 100,
        stdout: "",
        stderr: "",
      } satisfies ExecuteResult;
    }),
    listTests: vi.fn(async () => []),
  };
}

describe("runConfirmLocal", () => {
  it("returns broken when all runs fail", async () => {
    const runner = createMockRunner(["fail", "fail", "fail"]);
    const result = await runConfirmLocal({
      suite: "tests/api.test.ts",
      testName: "handles timeout",
      repeat: 3,
      runner,
    });
    expect(result.failures).toBe(3);
    expect(result.verdict).toBe("broken");
    expect(runner.execute).toHaveBeenCalledTimes(3);
  });

  it("returns transient when all runs pass", async () => {
    const runner = createMockRunner(["pass", "pass", "pass"]);
    const result = await runConfirmLocal({
      suite: "tests/api.test.ts",
      testName: "handles timeout",
      repeat: 3,
      runner,
    });
    expect(result.failures).toBe(0);
    expect(result.verdict).toBe("transient");
  });

  it("returns flaky when mixed results", async () => {
    const runner = createMockRunner(["pass", "fail", "pass", "fail", "pass"]);
    const result = await runConfirmLocal({
      suite: "tests/api.test.ts",
      testName: "handles timeout",
      repeat: 5,
      runner,
    });
    expect(result.failures).toBe(2);
    expect(result.verdict).toBe("flaky");
  });
});
