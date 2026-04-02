import type { TestCaseResult, TestResultAdapter } from "./types.js";
import { resolveTestIdentity } from "../identity.js";

interface PlaywrightResult {
  status: string;
  duration: number;
  retry: number;
  error?: { message: string };
}

interface PlaywrightTest {
  projectName: string;
  results: PlaywrightResult[];
  status: string;
}

interface PlaywrightSpec {
  title: string;
  tests: PlaywrightTest[];
}

interface PlaywrightSuite {
  title: string;
  file?: string;
  suites?: PlaywrightSuite[];
  specs?: PlaywrightSpec[];
}

interface PlaywrightReport {
  suites: PlaywrightSuite[];
}

function walkSuites(
  suite: PlaywrightSuite,
  currentFile: string | null,
  currentTaskId: string | null,
  out: TestCaseResult[],
): void {
  const nextFile = suite.file ?? currentFile ?? suite.title;
  const nextTaskId = currentTaskId ?? suite.title;

  if (suite.specs) {
    for (const spec of suite.specs) {
      for (const test of spec.tests) {
        const lastResult = test.results[test.results.length - 1];
        const maxRetry = Math.max(...test.results.map((r) => r.retry));

        // Detect flaky: had retries and last result passed
        const isFlaky = maxRetry > 0 && lastResult.status === "passed";

        let status: TestCaseResult["status"];
        if (isFlaky) {
          status = "flaky";
        } else if (lastResult.status === "passed") {
          status = "passed";
        } else if (lastResult.status === "skipped") {
          status = "skipped";
        } else {
          status = "failed";
        }

        // Find first failure error message
        const firstFailure = test.results.find(
          (r) => r.status === "failed" && r.error,
        );

        const result: TestCaseResult = resolveTestIdentity({
          suite: nextFile,
          testName: spec.title,
          taskId: nextTaskId,
          status,
          durationMs: lastResult.duration,
          retryCount: maxRetry,
          variant: { project: test.projectName },
        });

        if (firstFailure?.error) {
          result.errorMessage = firstFailure.error.message;
        }

        out.push(result);
      }
    }
  }

  if (suite.suites) {
    for (const child of suite.suites) {
      walkSuites(child, nextFile, child.title, out);
    }
  }
}

export const playwrightAdapter: TestResultAdapter = {
  name: "playwright",
  parse(input: string): TestCaseResult[] {
    const report: PlaywrightReport = JSON.parse(input);
    const results: TestCaseResult[] = [];
    for (const suite of report.suites) {
      walkSuites(suite, suite.file ?? null, suite.title, results);
    }
    return results;
  },
};
