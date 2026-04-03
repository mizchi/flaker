import type { MetricStore } from "../storage/types.js";
import type {
  MetriciCore,
  SamplingHistoryRowInput,
  SamplingListedTestInput,
  StableVariantEntryInput,
  TestMeta,
} from "../core/loader.js";
import type { DependencyResolver } from "../resolvers/types.js";
import type { TestId } from "../runners/types.js";
import type { SamplingMode } from "./sampling-options.js";
import { loadCore } from "../core/loader.js";
import { createStableTestId } from "../identity.js";
import {
  isManifestQuarantined,
  type QuarantineManifestEntry,
} from "../quarantine-manifest.js";

export interface SampleOpts {
  store: MetricStore;
  count?: number;
  percentage?: number;
  mode: SamplingMode;
  seed?: number;
  resolver?: DependencyResolver;
  changedFiles?: string[];
  skipQuarantined?: boolean;
  quarantineManifestEntries?: QuarantineManifestEntry[];
  listedTests?: TestId[];
  coFailureDays?: number;
}

export interface SamplingSummary {
  strategy: SamplingMode;
  requestedCount: number | null;
  requestedPercentage: number | null;
  seed: number;
  changedFiles: string[] | null;
  candidateCount: number;
  selectedCount: number;
  sampleRatio: number | null;
  estimatedSavedTests: number;
  estimatedSavedMinutes: number | null;
  fallbackReason: string | null;
}

export interface SamplingConfidenceEstimate {
  ciPassWhenLocalPassRate: number | null;
}

export interface SamplePlan {
  sampled: TestMeta[];
  allTests: TestMeta[];
  summary: SamplingSummary;
}

function toCoreVariantEntries(
  variant?: Record<string, string> | null,
): StableVariantEntryInput[] | null {
  if (!variant) {
    return null;
  }
  const entries = Object.entries(variant)
    .filter(([, value]) => value != null)
    .map(([key, value]) => ({ key, value: String(value) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return entries.length > 0 ? entries : null;
}

function createListedTestKey(test: TestId): string {
  return (
    test.testId ??
    createStableTestId({
      suite: test.suite,
      testName: test.testName,
      taskId: test.taskId,
      filter: test.filter,
      variant: test.variant,
    })
  );
}

function createMetaKey(test: TestMeta): string {
  return (
    test.test_id ??
    createStableTestId({
      suite: test.suite,
      testName: test.test_name,
      taskId: test.task_id,
      filter: test.filter,
    })
  );
}

function buildListedTestIndex(listedTests: TestId[]): Map<string, TestId[]> {
  const index = new Map<string, TestId[]>();
  for (const test of listedTests) {
    const key = createListedTestKey(test);
    const existing = index.get(key);
    if (existing) {
      existing.push(test);
    } else {
      index.set(key, [test]);
    }
  }
  return index;
}

function filterMetaToListedTests(
  tests: TestMeta[],
  listedTests: TestId[],
): TestMeta[] {
  if (listedTests.length === 0) {
    return tests;
  }

  const remainingCounts = new Map<string, number>();
  for (const test of listedTests) {
    const key = createListedTestKey(test);
    remainingCounts.set(key, (remainingCounts.get(key) ?? 0) + 1);
  }

  const filtered: TestMeta[] = [];
  for (const test of tests) {
    const key = createMetaKey(test);
    const remaining = remainingCounts.get(key) ?? 0;
    if (remaining <= 0) {
      continue;
    }
    filtered.push(test);
    remainingCounts.set(key, remaining - 1);
  }
  return filtered;
}

export async function runSample(opts: SampleOpts): Promise<TestMeta[]> {
  const plan = await planSample(opts);
  return plan.sampled;
}

export async function planSample(opts: SampleOpts): Promise<SamplePlan> {
  const core = await loadCore();
  const listedTests = opts.listedTests ?? [];
  const meta = await buildSamplingMeta(opts.store, listedTests, core);
  // Ensure co_failure_boost is always present (MoonBit may not include it until rebuilt)
  let allTests = meta.tests.map((t) => ({
    ...t,
    co_failure_boost: t.co_failure_boost ?? 0,
  }));

  // Apply co-failure boosts if changedFiles are provided
  if (opts.changedFiles && opts.changedFiles.length > 0) {
    const boosts = await opts.store.getCoFailureBoosts(
      opts.changedFiles,
      { windowDays: opts.coFailureDays ?? 90 },
    );
    if (boosts.size > 0) {
      allTests = allTests.map((test) => {
        const key = test.test_id ?? createStableTestId({
          suite: test.suite,
          testName: test.test_name,
          taskId: test.task_id,
          filter: test.filter,
        });
        const boost = boosts.get(key) ?? 0;
        return boost > 0 ? { ...test, co_failure_boost: boost } : test;
      });
    }
  }

  if (opts.skipQuarantined) {
    const quarantined = await opts.store.queryQuarantined();
    const qSet = new Set(quarantined.map((q) => q.testId));
    const manifestEntries = opts.quarantineManifestEntries ?? [];
    const listedTestIndex = buildListedTestIndex(listedTests);
    allTests = allTests.filter((test) => {
      const key = createMetaKey(test);
      const enriched = listedTestIndex.get(key)?.[0];

      if (qSet.has(key)) {
        return false;
      }

      return !isManifestQuarantined(manifestEntries, {
        suite: enriched?.suite ?? test.suite,
        testName: enriched?.testName ?? test.test_name,
        taskId: enriched?.taskId ?? test.task_id ?? undefined,
      });
    });
  }

  let count: number;
  if (opts.percentage != null) {
    count = Math.round((opts.percentage / 100) * allTests.length);
  } else {
    count = opts.count ?? allTests.length;
  }

  const seed = opts.seed ?? Date.now();
  let sampled: TestMeta[];

  if (opts.mode === "affected") {
    if (!opts.resolver || !opts.changedFiles) {
      throw new Error("affected mode requires resolver and changedFiles");
    }
    const allSuites = [...new Set(allTests.map((test) => test.suite))];
    const affectedSuites = await opts.resolver.resolve(
      opts.changedFiles,
      allSuites,
    );
    sampled = allTests.filter((test) => affectedSuites.includes(test.suite));
  } else if (opts.mode === "hybrid") {
    if (!opts.resolver || !opts.changedFiles) {
      throw new Error("hybrid mode requires resolver and changedFiles");
    }
    const allSuites = [...new Set(allTests.map((test) => test.suite))];
    const affectedSuites = await opts.resolver.resolve(
      opts.changedFiles,
      allSuites,
    );
    sampled = core.sampleHybrid(allTests, affectedSuites, count, seed);
  } else if (opts.mode === "weighted") {
    sampled = core.sampleWeighted(allTests, count, seed);
  } else {
    sampled = core.sampleRandom(allTests, count, seed);
  }

  return {
    sampled,
    allTests,
    summary: buildSamplingSummary({
      strategy: opts.mode,
      requestedCount: opts.count ?? null,
      requestedPercentage: opts.percentage ?? null,
      seed,
      changedFiles: opts.changedFiles ?? null,
      allTests,
      sampled,
      fallbackReason: meta.fallbackReason,
    }),
  };
}

interface BuildSamplingSummaryOpts {
  strategy: SamplingMode;
  requestedCount: number | null;
  requestedPercentage: number | null;
  seed: number;
  changedFiles: string[] | null;
  allTests: TestMeta[];
  sampled: TestMeta[];
  fallbackReason: string | null;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(1));
}

function buildSamplingSummary(opts: BuildSamplingSummaryOpts): SamplingSummary {
  const totalDurationMs = opts.allTests.reduce(
    (sum, test) => sum + test.avg_duration_ms,
    0,
  );
  const selectedDurationMs = opts.sampled.reduce(
    (sum, test) => sum + test.avg_duration_ms,
    0,
  );
  const candidateCount = opts.allTests.length;
  const selectedCount = opts.sampled.length;
  const estimatedSavedMinutes = totalDurationMs > selectedDurationMs
    ? roundMetric((totalDurationMs - selectedDurationMs) / 60_000)
    : 0;
  return {
    strategy: opts.strategy,
    requestedCount: opts.requestedCount,
    requestedPercentage: opts.requestedPercentage,
    seed: opts.seed,
    changedFiles: opts.changedFiles,
    candidateCount,
    selectedCount,
    sampleRatio: candidateCount > 0
      ? roundMetric((selectedCount / candidateCount) * 100)
      : null,
    estimatedSavedTests: Math.max(candidateCount - selectedCount, 0),
    estimatedSavedMinutes,
    fallbackReason: opts.fallbackReason,
  };
}

export function formatSamplingSummary(
  summary: SamplingSummary,
  confidence?: SamplingConfidenceEstimate,
): string {
  const lines = [
    "# Sampling Summary",
    "",
    `  Strategy:                 ${summary.strategy}`,
    `  Selected tests:           ${summary.selectedCount} / ${summary.candidateCount}${summary.sampleRatio != null ? ` (${summary.sampleRatio}%)` : ""}`,
    `  Estimated saved tests:    ${summary.estimatedSavedTests}`,
    `  Estimated saved minutes:  ${summary.estimatedSavedMinutes ?? "N/A"}`,
    `  CI pass when local pass:  ${confidence?.ciPassWhenLocalPassRate != null ? `${confidence.ciPassWhenLocalPassRate}%` : "N/A"}`,
  ];
  if (summary.fallbackReason) {
    lines.push(`  Fallback reason:          ${summary.fallbackReason}`);
  }
  return lines.join("\n");
}

async function buildSamplingMeta(
  store: MetricStore,
  listedTests: TestId[],
  core: MetriciCore,
): Promise<{ tests: TestMeta[]; fallbackReason: string | null }> {
  const rows = await store.raw<{
    suite: string;
    test_name: string;
    task_id: string | null;
    filter_text: string | null;
    variant: string | null;
    test_id: string | null;
    status: string;
    retry_count: number;
    duration_ms: number;
    created_at: string;
  }>(`
    SELECT
      suite,
      test_name,
      task_id,
      filter_text,
      variant::VARCHAR AS variant,
      test_id,
      status,
      COALESCE(retry_count, 0)::INTEGER AS retry_count,
      COALESCE(duration_ms, 0)::INTEGER AS duration_ms,
      COALESCE(created_at::VARCHAR, '') AS created_at
    FROM test_results
  `);

  const historyRows: SamplingHistoryRowInput[] = rows.map((row) => ({
    suite: row.suite,
    test_name: row.test_name,
    task_id: row.task_id,
    filter: row.filter_text,
    variant: row.variant
      ? toCoreVariantEntries(
          JSON.parse(row.variant) as Record<string, string> | null,
        )
      : null,
    test_id: row.test_id,
    status: row.status,
    retry_count: row.retry_count,
    duration_ms: row.duration_ms,
    created_at: row.created_at,
  }));
  const listedInputs: SamplingListedTestInput[] = listedTests.map((test) => ({
    suite: test.suite,
    test_name: test.testName,
    task_id: test.taskId,
    filter: test.filter,
    variant: toCoreVariantEntries(test.variant),
    test_id: test.testId,
  }));

  return {
    tests: filterMetaToListedTests(
      core.buildSamplingMeta(historyRows, listedInputs),
      listedTests,
    ),
    fallbackReason:
      rows.length === 0 && listedTests.length > 0
        ? "cold-start-listed-tests"
        : null,
  };
}
