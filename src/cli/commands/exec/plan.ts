import type { MetricStore } from "../../storage/types.js";
import type { DependencyResolver } from "../../resolvers/types.js";
import type { TestId } from "../../runners/types.js";
import type { SamplingMode } from "./sampling-options.js";
import {
  loadCore,
  type FlakerCore,
  type SamplingHistoryRowInput,
  type SamplingListedTestInput,
  type StableVariantEntryInput,
  type TestMeta,
} from "../../core/loader.js";
import {
  isManifestQuarantined,
  loadQuarantineBridge,
  type QuarantineManifestEntry,
} from "../../quarantine-manifest.js";
import {
  createListedTestKey,
  createMetaKey,
  buildListedTestIndex,
} from "../dev/test-key.js";

export interface SampleOpts {
  store: MetricStore;
  count?: number;
  percentage?: number;
  mode: SamplingMode;
  fallbackMode?: SamplingMode;
  seed?: number;
  resolver?: DependencyResolver;
  changedFiles?: string[];
  skipQuarantined?: boolean;
  quarantineManifestEntries?: QuarantineManifestEntry[];
  listedTests?: TestId[];
  coFailureDays?: number;
  coFailureAlpha?: number;
  holdoutRatio?: number;
  samplingMeta?: PrecomputedSamplingMeta;
}

export interface SamplingSummary {
  strategy: SamplingMode;
  requestedCount: number | null;
  requestedPercentage: number | null;
  seed: number;
  changedFiles: string[] | null;
  candidateCount: number;
  selectedCount: number;
  holdoutCount: number;
  sampleRatio: number | null;
  estimatedSavedTests: number;
  estimatedSavedMinutes: number | null;
  fallbackReason: string | null;
  // Optional per-test selection metadata (minimal: filled with placeholder values)
  // TODO: populate with real tier/score/reason from planner internals
  reasons?: Array<{
    suite: string;
    test_name: string;
    task_id?: string | null;
    tier: string;
    score: number;
    reason: string;
  }>;
}

export interface SamplingConfidenceEstimate {
  ciPassWhenLocalPassRate: number | null;
}

export interface SamplePlan {
  sampled: TestMeta[];
  holdout: TestMeta[];
  allTests: TestMeta[];
  summary: SamplingSummary;
}

export interface PrecomputedSamplingMeta {
  tests: TestMeta[];
  fallbackReason: string | null;
}

interface SamplingFallbackHint {
  detail: string;
  nextAction: string;
  historyTarget: string;
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
  const meta = opts.samplingMeta ?? await prepareSamplingMeta(opts.store, listedTests, core);

  let allTests = meta.tests.map((t) => ({
    ...t,
    co_failure_boost: t.co_failure_boost ?? 0,
  }));

  allTests = await applyCoFailureBoosts(allTests, opts);

  if (opts.skipQuarantined) {
    allTests = await filterQuarantinedTests(
      allTests, opts.store, listedTests, opts.quarantineManifestEntries ?? [],
    );
  }

  const count = resolveCount(opts, allTests.length);
  const seed = opts.seed ?? Date.now();
  const { sampled, effectiveMode } = await selectByStrategy(
    allTests, count, seed, opts, core,
  );

  const holdout = selectHoldout(allTests, sampled, opts.holdoutRatio ?? 0, seed);

  return {
    sampled,
    holdout,
    allTests,
    summary: buildSamplingSummary({
      strategy: effectiveMode,
      requestedCount: opts.count ?? null,
      requestedPercentage: opts.percentage ?? null,
      seed,
      changedFiles: opts.changedFiles ?? null,
      allTests,
      sampled,
      holdoutCount: holdout.length,
      fallbackReason: meta.fallbackReason,
    }),
  };
}

async function applyCoFailureBoosts(
  tests: TestMeta[],
  opts: SampleOpts,
): Promise<TestMeta[]> {
  if (!opts.changedFiles?.length) return tests;

  const boosts = await opts.store.getCoFailureBoosts(
    opts.changedFiles,
    { windowDays: opts.coFailureDays ?? 90 },
  );
  if (boosts.size === 0) return tests;

  const alpha = opts.coFailureAlpha ?? 1.0;
  return tests.map((test) => {
    const boost = (boosts.get(createMetaKey(test)) ?? 0) * alpha;
    return boost > 0 ? { ...test, co_failure_boost: boost } : test;
  });
}

async function filterQuarantinedTests(
  tests: TestMeta[],
  store: MetricStore,
  listedTests: TestId[],
  manifestEntries: QuarantineManifestEntry[],
): Promise<TestMeta[]> {
  await loadQuarantineBridge();
  const quarantined = await store.queryQuarantined();
  const qSet = new Set(quarantined.map((q) => q.testId));
  const listedTestIndex = buildListedTestIndex(listedTests);
  return tests.filter((test) => {
    const key = createMetaKey(test);
    if (qSet.has(key)) return false;
    const enriched = listedTestIndex.get(key)?.[0];
    return !isManifestQuarantined(manifestEntries, {
      suite: enriched?.suite ?? test.suite,
      testName: enriched?.testName ?? test.test_name,
      taskId: enriched?.taskId ?? test.task_id ?? undefined,
    });
  });
}

function resolveCount(opts: SampleOpts, totalTests: number): number {
  if (opts.percentage != null) {
    return Math.round((opts.percentage / 100) * totalTests);
  }
  return opts.count ?? totalTests;
}

async function selectByStrategy(
  allTests: TestMeta[],
  count: number,
  seed: number,
  opts: SampleOpts,
  core: FlakerCore,
): Promise<{ sampled: TestMeta[]; effectiveMode: SamplingMode }> {
  const pickPrimary = async (
    mode: SamplingMode,
  ): Promise<{ sampled: TestMeta[]; effectiveMode: SamplingMode }> => {
    const effectiveMode: SamplingMode = mode;

    if (mode === "affected" || mode === "hybrid") {
      if (!opts.resolver || !opts.changedFiles) {
        throw new Error(`${mode} mode requires resolver and changedFiles`);
      }
      const allSuites = [...new Set(allTests.map((t) => t.suite))];
      const affectedSuites = await opts.resolver.resolve(opts.changedFiles, allSuites);
      if (mode === "affected") {
        return {
          sampled: allTests.filter((t) => affectedSuites.includes(t.suite)),
          effectiveMode,
        };
      }
      return {
        sampled: core.sampleHybrid(allTests, affectedSuites, count, seed),
        effectiveMode,
      };
    }

    if (mode === "full") {
      return {
        sampled: allTests,
        effectiveMode: "full",
      };
    }

    if (mode === "weighted") {
      return { sampled: core.sampleWeighted(allTests, count, seed), effectiveMode };
    }
    const unreachable: never = mode;
    throw new Error(`Unhandled sampling mode: ${String(unreachable)}`);
  };

  const primary = await pickPrimary(opts.mode);
  if (
    primary.sampled.length === 0
    && allTests.length > 0
    && opts.fallbackMode
    && opts.fallbackMode !== opts.mode
  ) {
    return pickPrimary(opts.fallbackMode);
  }

  return primary;
}

interface BuildSamplingSummaryOpts {
  strategy: SamplingMode;
  requestedCount: number | null;
  requestedPercentage: number | null;
  seed: number;
  changedFiles: string[] | null;
  allTests: TestMeta[];
  sampled: TestMeta[];
  holdoutCount: number;
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
    holdoutCount: opts.holdoutCount,
    sampleRatio: candidateCount > 0
      ? roundMetric((selectedCount / candidateCount) * 100)
      : null,
    estimatedSavedTests: Math.max(candidateCount - selectedCount, 0),
    estimatedSavedMinutes,
    fallbackReason: opts.fallbackReason,
    // Minimal: populate reasons with placeholder tier/score/reason
    // TODO: populate with real tier/score/reason from planner internals
    reasons: opts.sampled.map((t) => ({
      suite: t.suite,
      test_name: t.test_name,
      task_id: t.task_id ?? null,
      tier: "selected",
      score: 0,
      reason: "",
    })),
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
    `  Holdout tests:            ${summary.holdoutCount > 0 ? summary.holdoutCount : "disabled"}`,
    `  CI pass when local pass:  ${confidence?.ciPassWhenLocalPassRate != null ? `${confidence.ciPassWhenLocalPassRate}%` : "N/A"}`,
  ];
  if (summary.fallbackReason) {
    lines.push(`  Fallback reason:          ${summary.fallbackReason}`);
    const hint = describeSamplingFallback(summary.fallbackReason);
    if (hint) {
      lines.push(`  Fallback details:         ${hint.detail}`);
      lines.push(`  Next action:              ${hint.nextAction}`);
      lines.push(`  History target:           ${hint.historyTarget}`);
    }
  }
  return lines.join("\n");
}

function describeSamplingFallback(reason: string): SamplingFallbackHint | null {
  switch (reason) {
    case "cold-start-listed-tests":
      return {
        detail: "No historical test results were found, so flaker sampled from listed tests.",
        nextAction: "Run `flaker collect` or `flaker import`, then keep recording local runs.",
        historyTarget: "Aim for >= 5 runs/test (10 is better) before trusting flake trends.",
      };
    default:
      return null;
  }
}

export async function prepareSamplingMeta(
  store: MetricStore,
  listedTests: TestId[],
  core: FlakerCore,
): Promise<PrecomputedSamplingMeta> {
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

function selectHoldout(
  allTests: TestMeta[],
  sampled: TestMeta[],
  holdoutRatio: number,
  seed: number,
): TestMeta[] {
  if (holdoutRatio <= 0 || holdoutRatio > 1) {
    return [];
  }
  const sampledKeys = new Set(sampled.map(createMetaKey));
  const skipped = allTests.filter((t) => !sampledKeys.has(createMetaKey(t)));
  if (skipped.length === 0) {
    return [];
  }
  const holdoutCount = Math.max(1, Math.round(skipped.length * holdoutRatio));

  // Simple Fisher-Yates with LCG
  const arr = [...skipped];
  let state = seed >>> 0;
  for (let i = arr.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, holdoutCount);
}
