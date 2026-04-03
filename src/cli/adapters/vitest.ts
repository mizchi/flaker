import type { TestCaseResult, TestResultAdapter } from "./types.js";

interface VitestAssertionResult {
  ancestorTitles: string[];
  fullName: string;
  status: "passed" | "failed" | "pending" | "skipped" | "todo";
  title: string;
  duration: number;
  failureMessages: string[];
}

interface VitestTestResult {
  name: string;
  assertionResults: VitestAssertionResult[];
}

interface VitestJsonReport {
  testResults: VitestTestResult[];
}

export const vitestAdapter: TestResultAdapter = {
  name: "vitest",
  parse(input: string): TestCaseResult[] {
    const report: VitestJsonReport = JSON.parse(input);
    const results: TestCaseResult[] = [];

    for (const file of report.testResults) {
      const suite = file.name;
      for (const test of file.assertionResults) {
        if (test.status === "pending" || test.status === "todo") continue;

        results.push({
          suite,
          testName: test.fullName,
          status: test.status === "skipped" ? "skipped" : test.status,
          durationMs: Math.round(test.duration ?? 0),
          retryCount: 0,
          errorMessage: test.failureMessages.length > 0
            ? test.failureMessages[0]
            : undefined,
        });
      }
    }

    return results;
  },
};
