import type { TestCaseResult } from "../adapters/types.js";
import { normalizeVariant, resolveTestIdentity } from "../identity.js";
import {
  findMatchingManifestEntry,
  type QuarantineManifestEntry,
} from "../quarantine-manifest.js";
import type {
  ExecuteOpts,
  ExecuteResult,
  RunnerAdapter,
  TestId,
} from "./types.js";

function formatQuarantineMessage(entry: QuarantineManifestEntry): string {
  return `[quarantine:${entry.id}] mode=${entry.mode} owner=${entry.owner} reason=${entry.reason}`;
}

function appendQuarantineMessage(
  errorMessage: string | undefined,
  entry: QuarantineManifestEntry,
): string {
  const quarantineMessage = formatQuarantineMessage(entry);
  if (!errorMessage) {
    return quarantineMessage;
  }
  if (errorMessage.includes(quarantineMessage)) {
    return errorMessage;
  }
  return `${errorMessage}\n${quarantineMessage}`;
}

function annotateResult(
  result: TestCaseResult,
  entry: QuarantineManifestEntry,
): TestCaseResult {
  const shouldAnnotateMessage =
    result.status === "failed" ||
    result.status === "flaky" ||
    result.status === "skipped";

  return {
    ...result,
    quarantine: entry,
    errorMessage: shouldAnnotateMessage
      ? appendQuarantineMessage(result.errorMessage, entry)
      : result.errorMessage,
  };
}

function createSkippedResult(
  test: TestId,
  entry: QuarantineManifestEntry,
): TestCaseResult {
  const resolved = resolveTestIdentity(test);
  return {
    suite: resolved.suite,
    testName: resolved.testName,
    taskId: resolved.taskId,
    filter: resolved.filter,
    variant: resolved.variant,
    testId: resolved.testId,
    status: "skipped",
    durationMs: 0,
    retryCount: 0,
    errorMessage: formatQuarantineMessage(entry),
    quarantine: entry,
  };
}

function buildLookupKey(input: {
  suite: string;
  testName: string;
  filter?: string | null;
  variant?: Record<string, string> | null;
}): string {
  return JSON.stringify({
    suite: input.suite,
    testName: input.testName,
    filter: input.filter ?? null,
    variant: normalizeVariant(input.variant),
  });
}

function createRequestedIdentityLookup(tests: TestId[]): Map<string, TestId> {
  const lookup = new Map<string, TestId>();
  for (const test of tests) {
    lookup.set(buildLookupKey(test), resolveTestIdentity(test));
  }
  return lookup;
}

function resolveRuntimeIdentity(
  result: TestCaseResult,
  requestedLookup: Map<string, TestId>,
): TestCaseResult {
  const fallback = requestedLookup.get(buildLookupKey(result));
  return resolveTestIdentity({
    ...result,
    taskId: result.taskId ?? fallback?.taskId,
    filter: result.filter ?? fallback?.filter,
    variant: result.variant ?? fallback?.variant,
    testId: result.testId ?? fallback?.testId,
  });
}

export function isBlockingFailure(result: TestCaseResult): boolean {
  return (
    result.status === "failed" &&
    result.quarantine?.mode !== "allow_failure"
  );
}

function annotateRuntimeResults(
  results: TestCaseResult[],
  tests: TestId[],
  entries: QuarantineManifestEntry[],
): TestCaseResult[] {
  const requestedLookup = createRequestedIdentityLookup(tests);
  return results.map((result) => {
    const resolved = resolveRuntimeIdentity(result, requestedLookup);
    const entry = findMatchingManifestEntry(entries, resolved);
    if (!entry) {
      return resolved;
    }
    return annotateResult(resolved, entry);
  });
}

function computeExitCode(results: TestCaseResult[], fallbackExitCode: number): number {
  if (results.some(isBlockingFailure)) {
    return 1;
  }
  if (results.length === 0) {
    return fallbackExitCode;
  }
  return 0;
}

export function withQuarantineRuntime(
  runner: RunnerAdapter,
  entries: QuarantineManifestEntry[],
): RunnerAdapter {
  if (entries.length === 0) {
    return runner;
  }

  return {
    ...runner,
    name: `${runner.name}+quarantine`,
    async execute(tests: TestId[], opts?: ExecuteOpts): Promise<ExecuteResult> {
      const runnable: TestId[] = [];
      const skipped: TestCaseResult[] = [];

      for (const test of tests) {
        const entry = findMatchingManifestEntry(entries, test, {
          modes: ["skip"],
        });
        if (entry) {
          skipped.push(createSkippedResult(test, entry));
          continue;
        }
        runnable.push(test);
      }

      const baseResult =
        runnable.length > 0
          ? await runner.execute(runnable, opts)
          : {
              exitCode: 0,
              results: [],
              durationMs: 0,
              stdout: "",
              stderr: "",
            };

      const annotated = annotateRuntimeResults(baseResult.results, runnable, entries);
      const results = [...skipped, ...annotated];

      return {
        ...baseResult,
        results,
        exitCode: computeExitCode(results, baseResult.exitCode),
      };
    },
    async listTests(opts?: ExecuteOpts): Promise<TestId[]> {
      return runner.listTests(opts);
    },
  };
}
