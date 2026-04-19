import type { RunnerAdapter, TestId, ExecuteOpts, ExecuteResult } from "./types.js";
import type { TestCaseResult } from "../adapters/types.js";
import { resolveTestIdentity } from "../identity.js";
import { isBlockingFailure } from "./quarantine-runtime.js";

interface RetryOpts extends ExecuteOpts {
  maxRetries: number;
  retryFailedOnly: boolean;
}

export interface RetryResult extends ExecuteResult {
  retriedTests: number;
  totalAttempts: number;
  flakyDetected: TestId[];
}

export async function executeWithRetry(
  runner: RunnerAdapter,
  tests: TestId[],
  opts: RetryOpts,
): Promise<RetryResult> {
  const { maxRetries, retryFailedOnly, ...executeOpts } = opts;

  // First attempt
  const firstResult = await runner.execute(tests, executeOpts);

  if (firstResult.exitCode === 0 || maxRetries <= 0) {
    return {
      ...firstResult,
      retriedTests: 0,
      totalAttempts: 1,
      flakyDetected: [],
    };
  }

  const allResults = new Map<string, TestCaseResult[]>();
  // Track results per test
  for (const r of firstResult.results) {
    const resolved = resolveTestIdentity(r);
    allResults.set(resolved.testId, [resolved]);
  }

  let retriedTests = 0;
  let totalAttempts = 1;
  let lastResult = firstResult;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Find tests to retry based on the latest results
    const testsToRetry: TestId[] = [];
    for (const r of lastResult.results) {
      const resolved = resolveTestIdentity(r);
      if (await isBlockingFailure(resolved)) {
        testsToRetry.push({
          suite: resolved.suite,
          testName: resolved.testName,
          taskId: resolved.taskId,
          filter: resolved.filter,
          variant: resolved.variant,
          testId: resolved.testId,
        });
      }
    }

    if (retryFailedOnly && testsToRetry.length === 0) break;

    const retryTargets = retryFailedOnly ? testsToRetry : tests;
    if (retryTargets.length === 0) break;

    totalAttempts++;
    retriedTests = retryTargets.length;
    const retryResult = await runner.execute(retryTargets, executeOpts);
    lastResult = retryResult;

    // Merge results
    for (const r of retryResult.results) {
      const resolved = resolveTestIdentity(r);
      const key = resolved.testId;
      const history = allResults.get(key) ?? [];
      history.push(resolved);
      allResults.set(key, history);
    }

    // If all pass now, stop retrying
    if (retryResult.exitCode === 0) break;
  }

  // Build final results: use last attempt's status, but mark flaky
  const finalResults: TestCaseResult[] = [];
  const flakyDetected: TestId[] = [];

  for (const [key, history] of allResults) {
    const lastResultEntry = history[history.length - 1];
    const hasFailure = history.some(r => r.status === "failed");
    const lastPassed = lastResultEntry.status === "passed";

    if (hasFailure && lastPassed) {
      // Failed at first, passed on retry = flaky
      flakyDetected.push({
        suite: lastResultEntry.suite,
        testName: lastResultEntry.testName,
        taskId: lastResultEntry.taskId,
        filter: lastResultEntry.filter,
        variant: lastResultEntry.variant,
        testId: lastResultEntry.testId,
      });
      finalResults.push({
        ...lastResultEntry,
        status: "flaky",
        retryCount: history.length - 1,
        errorMessage: history.find(r => r.status === "failed")?.errorMessage,
      });
    } else {
      finalResults.push({
        ...lastResultEntry,
        retryCount: history.length - 1,
      });
    }
  }

  const blockingResults = await Promise.all(finalResults.map(isBlockingFailure));
  const exitCode = blockingResults.some(Boolean) ? 1 : 0;

  return {
    exitCode,
    results: finalResults,
    durationMs: firstResult.durationMs,
    stdout: firstResult.stdout,
    stderr: firstResult.stderr,
    retriedTests,
    totalAttempts,
    flakyDetected,
  };
}
