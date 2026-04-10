import { describe, it, expect } from "vitest";
import {
  compareRetryResults,
  formatRetryReport,
  type RetryTestResult,
} from "../../src/cli/commands/debug/retry.js";

describe("compareRetryResults", () => {
  it("marks reproduced when local also fails", () => {
    const ciFailures = [
      { suite: "tests/api.test.ts", testName: "handles timeout" },
    ];
    const localResults = [
      { suite: "tests/api.test.ts", testName: "handles timeout", status: "failed" as const, durationMs: 100 },
    ];
    const result = compareRetryResults(ciFailures, localResults);
    expect(result).toHaveLength(1);
    expect(result[0].reproduced).toBe(true);
  });

  it("marks not reproduced when local passes", () => {
    const ciFailures = [
      { suite: "tests/api.test.ts", testName: "handles timeout" },
    ];
    const localResults = [
      { suite: "tests/api.test.ts", testName: "handles timeout", status: "passed" as const, durationMs: 100 },
    ];
    const result = compareRetryResults(ciFailures, localResults);
    expect(result).toHaveLength(1);
    expect(result[0].reproduced).toBe(false);
  });

  it("marks not reproduced when test not found in local results", () => {
    const ciFailures = [
      { suite: "tests/api.test.ts", testName: "handles timeout" },
    ];
    const localResults: Array<{ suite: string; testName: string; status: "passed" | "failed"; durationMs: number }> = [];
    const result = compareRetryResults(ciFailures, localResults);
    expect(result).toHaveLength(1);
    expect(result[0].reproduced).toBe(false);
  });

  it("handles multiple failures", () => {
    const ciFailures = [
      { suite: "tests/api.test.ts", testName: "handles timeout" },
      { suite: "tests/db.test.ts", testName: "concurrent write" },
      { suite: "tests/auth.test.ts", testName: "token refresh" },
    ];
    const localResults = [
      { suite: "tests/api.test.ts", testName: "handles timeout", status: "failed" as const, durationMs: 100 },
      { suite: "tests/db.test.ts", testName: "concurrent write", status: "passed" as const, durationMs: 200 },
      { suite: "tests/auth.test.ts", testName: "token refresh", status: "failed" as const, durationMs: 150 },
    ];
    const result = compareRetryResults(ciFailures, localResults);
    expect(result.filter((r) => r.reproduced)).toHaveLength(2);
    expect(result.filter((r) => !r.reproduced)).toHaveLength(1);
  });
});

describe("formatRetryReport", () => {
  it("formats report with reproduced and not-reproduced tests", () => {
    const results: RetryTestResult[] = [
      { suite: "tests/api.test.ts", testName: "handles timeout", reproduced: true },
      { suite: "tests/db.test.ts", testName: "concurrent write", reproduced: false },
    ];
    const output = formatRetryReport(12345678, results);
    expect(output).toContain("12345678");
    expect(output).toContain("handles timeout");
    expect(output).toContain("reproduced");
    expect(output).toContain("not reproduced");
    expect(output).toContain("Reproduced:     1/2");
  });

  it("formats report when all reproduced", () => {
    const results: RetryTestResult[] = [
      { suite: "tests/api.test.ts", testName: "test1", reproduced: true },
    ];
    const output = formatRetryReport(999, results);
    expect(output).toContain("Reproduced:     1/1");
    expect(output).not.toContain("Not reproduced:");
  });

  it("formats report when none reproduced", () => {
    const results: RetryTestResult[] = [
      { suite: "tests/api.test.ts", testName: "test1", reproduced: false },
    ];
    const output = formatRetryReport(999, results);
    expect(output).toContain("Not reproduced: 1/1");
  });
});
