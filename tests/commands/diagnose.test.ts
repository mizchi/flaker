import { describe, it, expect } from "vitest";
import type { RunnerAdapter, TestId } from "../../src/cli/runners/types.js";
import type { TestCaseResult } from "../../src/cli/adapters/types.js";
import { runDiagnose, formatDiagnoseReport, type DiagnoseOpts } from "../../src/cli/commands/debug/diagnose.js";

function createMockRunner(results: TestCaseResult[]): RunnerAdapter {
  return {
    name: "mock",
    capabilities: { nativeParallel: false },
    async execute(tests: TestId[], opts?: { env?: Record<string, string> }): Promise<{
      exitCode: number;
      results: TestCaseResult[];
      durationMs: number;
      stdout: string;
      stderr: string;
    }> {
      return {
        exitCode: results.some((r) => r.status === "failed") ? 1 : 0,
        results,
        durationMs: 100,
        stdout: "",
        stderr: "",
      };
    },
    async listTests(): Promise<TestId[]> {
      return results.map((r) => ({ suite: r.suite, testName: r.testName }));
    },
  };
}

describe("runDiagnose", () => {
  it("reports baseline for a passing test", async () => {
    const runner = createMockRunner([
      { suite: "auth.test.ts", testName: "login", status: "passed", durationMs: 50, retryCount: 0 },
    ]);

    const report = await runDiagnose({
      runner,
      suite: "auth.test.ts",
      testName: "login",
      runs: 2,
      mutations: [],
    });

    expect(report.target.suite).toBe("auth.test.ts");
    expect(report.target.testName).toBe("login");
    expect(report.baseline.failureRate).toBe(0);
    expect(report.diagnosis.length).toBeGreaterThan(0);
  });

  it("detects always-failing test", async () => {
    const runner = createMockRunner([
      { suite: "broken.test.ts", testName: "always fails", status: "failed", durationMs: 50, retryCount: 0 },
    ]);

    const report = await runDiagnose({
      runner,
      suite: "broken.test.ts",
      testName: "always fails",
      runs: 2,
      mutations: [],
    });

    expect(report.baseline.failureRate).toBe(100);
  });
});

describe("formatDiagnoseReport", () => {
  it("formats report as readable text", () => {
    const report = {
      target: { suite: "auth.test.ts", testName: "login" },
      baseline: { name: "baseline", runs: 3, failures: 0, failureRate: 0, results: [] },
      mutations: [
        { name: "order-shuffle", runs: 3, failures: 0, failureRate: 0, results: [] },
        { name: "env-mutate", runs: 3, failures: 1, failureRate: 33.33, results: [] },
      ],
      diagnosis: [
        "order-shuffle: baseline と同程度 (0% vs 0%)",
        "🌍 環境依存の疑い: env-mutate で失敗率が上昇 (0% → 33.33%)",
      ],
    };

    const output = formatDiagnoseReport(report);
    expect(output).toContain("# Diagnose Report");
    expect(output).toContain("auth.test.ts > login");
    expect(output).toContain("order-shuffle");
    expect(output).toContain("env-mutate");
    expect(output).toContain("環境依存");
  });
});
