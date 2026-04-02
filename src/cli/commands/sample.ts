import type { MetricStore } from "../storage/types.js";
import type { TestMeta, MetriciCore } from "../core/loader.js";
import type { DependencyResolver } from "../resolvers/types.js";
import type { TestId } from "../runners/types.js";
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
  mode: "random" | "weighted" | "affected" | "hybrid";
  seed?: number;
  resolver?: DependencyResolver;
  changedFiles?: string[];
  skipQuarantined?: boolean;
  quarantineManifestEntries?: QuarantineManifestEntry[];
  listedTests?: TestId[];
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

export async function runSample(opts: SampleOpts): Promise<TestMeta[]> {
  const core = await loadCore();
  let allTests = await buildTestMeta(opts.store);
  if (opts.skipQuarantined) {
    const quarantined = await opts.store.queryQuarantined();
    const qSet = new Set(quarantined.map((q) => q.testId));
    const manifestEntries = opts.quarantineManifestEntries ?? [];
    const listedTestIndex = buildListedTestIndex(opts.listedTests ?? []);
    allTests = allTests.filter(
      (t) => {
        const key = `${t.suite}\0${t.test_name}`;
        const enriched = listedTestIndex.get(key)?.[0];
        const plainId = createStableTestId({
          suite: t.suite,
          testName: t.test_name,
        });
        const enrichedId = enriched
          ? createStableTestId({
              suite: enriched.suite,
              testName: enriched.testName,
              taskId: enriched.taskId,
              filter: enriched.filter,
              variant: enriched.variant,
            })
          : null;

        if (qSet.has(plainId) || (enrichedId != null && qSet.has(enrichedId))) {
          return false;
        }

        return !isManifestQuarantined(manifestEntries, {
          suite: enriched?.suite ?? t.suite,
          testName: enriched?.testName ?? t.test_name,
          taskId: enriched?.taskId,
        });
      },
    );
  }

  let count: number;
  if (opts.percentage != null) {
    count = Math.round((opts.percentage / 100) * allTests.length);
  } else {
    count = opts.count ?? allTests.length;
  }

  const seed = opts.seed ?? Date.now();

  if (opts.mode === "affected") {
    if (!opts.resolver || !opts.changedFiles) {
      throw new Error("affected mode requires resolver and changedFiles");
    }
    const allSuites = allTests.map((t) => t.suite);
    const affectedSuites = await opts.resolver.resolve(opts.changedFiles, allSuites);
    return allTests.filter((t) => affectedSuites.includes(t.suite));
  }

  if (opts.mode === "hybrid") {
    if (!opts.resolver || !opts.changedFiles) {
      throw new Error("hybrid mode requires resolver and changedFiles");
    }
    const allSuites = allTests.map((t) => t.suite);
    const affectedSuites = await opts.resolver.resolve(opts.changedFiles, allSuites);
    return core.sampleHybrid(allTests, affectedSuites, count, seed);
  }

  if (opts.mode === "weighted") {
    return core.sampleWeighted(allTests, count, seed);
  }
  return core.sampleRandom(allTests, count, seed);
}

async function buildTestMeta(store: MetricStore): Promise<TestMeta[]> {
  const rows = await store.raw<{
    suite: string;
    test_name: string;
    total_runs: number;
    fail_count: number;
    flaky_rate: number;
    last_run_at: string;
    avg_duration_ms: number;
    previously_failed: boolean;
    first_seen_at: string;
  }>(`
    SELECT
      suite,
      test_name,
      COUNT(*)::INTEGER AS total_runs,
      COUNT(*) FILTER (WHERE status = 'failed')::INTEGER AS fail_count,
      ROUND(COUNT(*) FILTER (WHERE status = 'failed') * 100.0 / COUNT(*), 2)::DOUBLE AS flaky_rate,
      MAX(created_at)::VARCHAR AS last_run_at,
      ROUND(AVG(duration_ms), 2)::DOUBLE AS avg_duration_ms,
      (COUNT(*) FILTER (WHERE status = 'failed') > 0)::BOOLEAN AS previously_failed,
      MIN(created_at)::VARCHAR AS first_seen_at
    FROM test_results
    GROUP BY suite, test_name
  `);

  return rows.map((r) => ({
    suite: r.suite,
    test_name: r.test_name,
    flaky_rate: r.flaky_rate,
    total_runs: r.total_runs,
    fail_count: r.fail_count,
    last_run_at: r.last_run_at,
    avg_duration_ms: r.avg_duration_ms,
    previously_failed: r.previously_failed,
    is_new: r.total_runs <= 1,
  }));
}
