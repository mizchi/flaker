import type { TestCaseResult } from "../adapters/types.js";
import { MOONBIT_JS_BRIDGE_URL } from "../core/build-artifact.js";
import { normalizeVariant, resolveTestIdentity } from "../identity.js";
import {
  findMatchingManifestEntry,
  loadQuarantineBridge,
  type QuarantineManifestEntry,
} from "../quarantine-manifest.js";
import type {
  ExecuteOpts,
  ExecuteResult,
  RunnerAdapter,
  TestId,
} from "./types.js";

interface QuarantineRuntimeResultInput {
  status: TestCaseResult["status"];
  quarantine_mode?: QuarantineManifestEntry["mode"];
}

interface QuarantineRuntimeCoreExports {
  is_blocking_failure_json: (resultJson: string) => string;
  compute_quarantine_exit_code_json: (
    resultsJson: string,
    fallbackExitCode: number,
  ) => string;
}

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

export async function isBlockingFailure(result: TestCaseResult): Promise<boolean> {
  const decisions = await getQuarantineRuntimeDecisions();
  return decisions.isBlockingFailure(result);
}

function toCoreRuntimeResultInput(
  result: TestCaseResult,
): QuarantineRuntimeResultInput {
  return result.quarantine?.mode
    ? { status: result.status, quarantine_mode: result.quarantine.mode }
    : { status: result.status };
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

interface QuarantineRuntimeDecisions {
  isBlockingFailure: (result: TestCaseResult) => boolean;
  computeExitCode: (results: TestCaseResult[], fallbackExitCode: number) => number;
}

let cachedQuarantineRuntimeDecisions: QuarantineRuntimeDecisions | undefined;
let quarantineRuntimeLoadPromise: Promise<QuarantineRuntimeDecisions> | undefined;

async function getQuarantineRuntimeDecisions(): Promise<QuarantineRuntimeDecisions> {
  if (cachedQuarantineRuntimeDecisions) return cachedQuarantineRuntimeDecisions;
  if (quarantineRuntimeLoadPromise) return quarantineRuntimeLoadPromise;
  quarantineRuntimeLoadPromise = (async () => {
    const mod = (await import(MOONBIT_JS_BRIDGE_URL.href)) as QuarantineRuntimeCoreExports;
    if (
      typeof mod.is_blocking_failure_json !== "function" ||
      typeof mod.compute_quarantine_exit_code_json !== "function"
    ) {
      throw new Error("MoonBit quarantine bridge is missing. Run 'moon build --target js' first.");
    }
    const decisions: QuarantineRuntimeDecisions = {
      isBlockingFailure(result) {
        return JSON.parse(
          mod.is_blocking_failure_json(
            JSON.stringify(toCoreRuntimeResultInput(result)),
          ),
        ) as boolean;
      },
      computeExitCode(results, fallbackExitCode) {
        return JSON.parse(
          mod.compute_quarantine_exit_code_json(
            JSON.stringify(results.map(toCoreRuntimeResultInput)),
            fallbackExitCode,
          ),
        ) as number;
      },
    };
    cachedQuarantineRuntimeDecisions = decisions;
    return decisions;
  })();
  return quarantineRuntimeLoadPromise;
}

async function computeExitCode(results: TestCaseResult[], fallbackExitCode: number): Promise<number> {
  const decisions = await getQuarantineRuntimeDecisions();
  return decisions.computeExitCode(results, fallbackExitCode);
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
      await loadQuarantineBridge();
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
        exitCode: await computeExitCode(results, baseResult.exitCode),
      };
    },
    async listTests(opts?: ExecuteOpts): Promise<TestId[]> {
      return runner.listTests(opts);
    },
  };
}
