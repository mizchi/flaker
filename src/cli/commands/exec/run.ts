import type { MetricStore } from "../../storage/types.js";
import {
  planSample,
  type SamplingSummary,
} from "../sample.js";
import type { SamplingMode } from "./sampling-options.js";
import type { QuarantineManifestEntry } from "../../quarantine-manifest.js";
import type { DependencyResolver } from "../../resolvers/types.js";
import {
  orchestrate,
  withQuarantineRuntime,
  type ExecuteResult,
  type RunnerAdapter,
  type TestId,
} from "../../runners/index.js";
import {
  createMetaKey,
  buildListedTestIndex,
} from "../test-key.js";

export interface RunOpts {
  store: MetricStore;
  runner: RunnerAdapter;
  count?: number;
  percentage?: number;
  mode: SamplingMode;
  fallbackMode?: SamplingMode;
  seed?: number;
  resolver?: DependencyResolver;
  changedFiles?: string[];
  skipQuarantined?: boolean;
  quarantineManifestEntries?: QuarantineManifestEntry[];
  cwd?: string;
  coFailureDays?: number;
  holdoutRatio?: number;
}

export interface RunCommandResult extends ExecuteResult {
  samplingSummary: SamplingSummary;
  sampledTests: TestId[];
  holdoutTests: TestId[];
  holdoutResult?: ExecuteResult;
}

function enrichSampledTests(
  sampled: Array<{
    suite: string;
    test_name: string;
    task_id?: string | null;
    filter?: string | null;
    test_id?: string | null;
  }>,
  listedTests: TestId[],
): TestId[] {
  const index = buildListedTestIndex(listedTests);
  return sampled.map((test) => {
    const key = createMetaKey(test);
    const enriched = index.get(key)?.shift();
    return (
      enriched ?? {
        suite: test.suite,
        testName: test.test_name,
        taskId: test.task_id ?? undefined,
        filter: test.filter ?? undefined,
        testId: test.test_id ?? undefined,
      }
    );
  });
}

async function loadListedTests(
  runner: RunnerAdapter,
  cwd?: string,
): Promise<TestId[]> {
  try {
    return await runner.listTests({ cwd });
  } catch {
    return [];
  }
}

export async function runTests(opts: RunOpts): Promise<RunCommandResult> {
  const listedTests = await loadListedTests(opts.runner, opts.cwd);
  const plan = await planSample({
    store: opts.store,
    count: opts.count,
    percentage: opts.percentage,
    mode: opts.mode,
    fallbackMode: opts.fallbackMode,
    seed: opts.seed,
    resolver: opts.resolver,
    changedFiles: opts.changedFiles,
    skipQuarantined: opts.skipQuarantined,
    quarantineManifestEntries: opts.quarantineManifestEntries,
    listedTests,
    coFailureDays: opts.coFailureDays,
    holdoutRatio: opts.holdoutRatio,
  });
  const runtimeRunner =
    opts.quarantineManifestEntries && opts.quarantineManifestEntries.length > 0
      ? withQuarantineRuntime(opts.runner, opts.quarantineManifestEntries)
      : opts.runner;
  const tests = enrichSampledTests(plan.sampled, listedTests);
  const result = await orchestrate(runtimeRunner, tests, { cwd: opts.cwd });

  // Run holdout tests if any
  const holdoutTests = enrichSampledTests(plan.holdout, listedTests);
  let holdoutResult: ExecuteResult | undefined;
  if (holdoutTests.length > 0) {
    holdoutResult = await orchestrate(runtimeRunner, holdoutTests, { cwd: opts.cwd });
  }

  return {
    ...result,
    samplingSummary: plan.summary,
    sampledTests: tests,
    holdoutTests,
    holdoutResult,
  };
}
