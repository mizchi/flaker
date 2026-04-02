import type { MetricStore } from "../storage/types.js";
import { runSample } from "./sample.js";
import type { QuarantineManifestEntry } from "../quarantine-manifest.js";
import {
  orchestrate,
  withQuarantineRuntime,
  type ExecuteResult,
  type RunnerAdapter,
  type TestId,
} from "../runners/index.js";

export interface RunOpts {
  store: MetricStore;
  runner: RunnerAdapter;
  count?: number;
  percentage?: number;
  mode: "random" | "weighted";
  seed?: number;
  skipQuarantined?: boolean;
  quarantineManifestEntries?: QuarantineManifestEntry[];
  cwd?: string;
}

function buildListedTestIndex(listedTests: TestId[]): Map<string, TestId[]> {
  const index = new Map<string, TestId[]>();
  for (const test of listedTests) {
    const key = `${test.suite}\0${test.testName}`;
    const existing = index.get(key);
    if (existing) {
      existing.push(test);
    } else {
      index.set(key, [test]);
    }
  }
  return index;
}

function enrichSampledTests(sampled: Array<{ suite: string; test_name: string }>, listedTests: TestId[]): TestId[] {
  const index = buildListedTestIndex(listedTests);
  return sampled.map((test) => {
    const key = `${test.suite}\0${test.test_name}`;
    const enriched = index.get(key)?.shift();
    return (
      enriched ?? {
        suite: test.suite,
        testName: test.test_name,
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

export async function runTests(opts: RunOpts): Promise<ExecuteResult> {
  const listedTests = await loadListedTests(opts.runner, opts.cwd);
  const sampled = await runSample({
    store: opts.store,
    count: opts.count,
    percentage: opts.percentage,
    mode: opts.mode,
    seed: opts.seed,
    skipQuarantined: opts.skipQuarantined,
    quarantineManifestEntries: opts.quarantineManifestEntries,
    listedTests,
  });
  const runtimeRunner =
    opts.quarantineManifestEntries && opts.quarantineManifestEntries.length > 0
      ? withQuarantineRuntime(opts.runner, opts.quarantineManifestEntries)
      : opts.runner;
  const tests = enrichSampledTests(sampled, listedTests);
  return orchestrate(runtimeRunner, tests, { cwd: opts.cwd });
}
