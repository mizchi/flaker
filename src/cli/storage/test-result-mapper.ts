import type { TestCaseResult } from "../adapters/types.js";
import type { TestResult } from "./types.js";

interface StoredTestResultBase {
  workflowRunId: number;
  commitSha: string;
  createdAt: Date;
}

export function toStoredTestResult(
  testCase: TestCaseResult,
  base: StoredTestResultBase,
): TestResult {
  return {
    workflowRunId: base.workflowRunId,
    suite: testCase.suite,
    testName: testCase.testName,
    taskId: testCase.taskId,
    filter: testCase.filter,
    status: testCase.status,
    durationMs: testCase.durationMs,
    retryCount: testCase.retryCount,
    errorMessage: testCase.errorMessage ?? null,
    commitSha: base.commitSha,
    variant: testCase.variant ?? null,
    testId: testCase.testId,
    quarantine: testCase.quarantine ?? null,
    createdAt: base.createdAt,
  };
}
