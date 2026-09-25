// src/cli/datasets/facts.ts
/**
 * Facts that several outputs report (status, plan/apply, explain, calibrate),
 * defined once over the flaker_v1 datasets and their windowed macros.
 */
import type { MetricStore } from "../storage/types.js";
import { naiveUtc, readCoFailuresWindow, readFlakyWindow, isBroken, type WindowOpts } from "./windowed.js";

export type DataConfidence = "insufficient" | "low" | "moderate" | "high";

/** How much history there is, by distinct commits with results. */
export function dataConfidence(commitCount: number): DataConfidence {
  if (commitCount < 5) return "insufficient";
  if (commitCount < 30) return "low";
  if (commitCount < 100) return "moderate";
  return "high";
}

export interface TestHealth {
  /** Tests with at least `minRuns` runs in the window. */
  classified: number;
  /** flaker_v1.flaky.is_flaky among them. */
  flaky: number;
  /** Failed every run with no flake evidence. */
  broken: number;
  /** Failed at least once. */
  failing: number;
}

/** Test counts by health, from flaker_v1.flaky over the window. */
export async function testHealth(
  store: MetricStore,
  opts: WindowOpts & { ciOnly?: boolean; minRuns?: number },
): Promise<TestHealth> {
  const minRuns = opts.minRuns ?? 5;
  const rows = (await readFlakyWindow(store, opts)).filter((r) => r.runs >= minRuns);
  return {
    classified: rows.length,
    flaky: rows.filter((r) => r.is_flaky).length,
    broken: rows.filter(isBroken).length,
    failing: rows.filter((r) => r.failures > 0).length,
  };
}

function bounds(opts: WindowOpts): [string, string] {
  const until = opts.now ?? new Date();
  return [naiveUtc(new Date(until.getTime() - opts.windowDays * 86_400_000)), naiveUtc(until)];
}

/**
 * Distinct commits and tests with results in the window, from flaker_v1.results
 * and flaker_v1.runs (mutation trials excluded). `source` narrows to CI or
 * local runs, as flaker_v1.runs classifies them.
 */
export async function historyCounts(
  store: MetricStore,
  opts: WindowOpts & { source?: "ci" | "local" },
): Promise<{ commits: number; tests: number; results: number }> {
  const [since, until] = bounds(opts);
  const [row] = await store.raw<{ commits: number; tests: number; results: number }>(
    `SELECT COUNT(DISTINCT ru.commit_sha)::INTEGER AS commits,
       COUNT(DISTINCT r.test_key)::INTEGER AS tests,
       COUNT(*)::INTEGER AS results
     FROM flaker_v1.results r
     JOIN flaker_v1.runs ru ON ru.run_id = r.run_id
     WHERE ru.source <> 'mutation'
       AND r.created_at > ?::TIMESTAMP AND r.created_at <= ?::TIMESTAMP
       AND (?::VARCHAR IS NULL OR ru.source = ?::VARCHAR)`,
    [since, until, opts.source ?? null, opts.source ?? null],
  );
  return { commits: row?.commits ?? 0, tests: row?.tests ?? 0, results: row?.results ?? 0 };
}

/**
 * Mean co-failure strength of (changed file, test) pairs seen on at least
 * `minChanges` commits, from flaker_v1.co_failures over the window; null
 * without any such pair.
 */
export async function coFailureStrength(
  store: MetricStore,
  opts: WindowOpts & { minChanges?: number },
): Promise<number | null> {
  const minChanges = opts.minChanges ?? 3;
  const rows = (await readCoFailuresWindow(store, opts)).filter((r) => r.changes >= minChanges);
  if (rows.length === 0) return null;
  return rows.reduce((sum, r) => sum + r.strength, 0) / rows.length;
}

export interface Activity {
  runs: { total: number; ci: number; local: number };
  results: { total: number; passed: number; failed: number; tests: number; commits: number };
}

/**
 * Runs and results in the window, from flaker_v1.runs / flaker_v1.results
 * (mutation trials excluded). `passed` is a first-try pass; `failed` counts
 * every failing result, retried passes included, as flaker_v1.flaky does.
 */
export async function activity(store: MetricStore, opts: WindowOpts): Promise<Activity> {
  const [since, until] = bounds(opts);
  const [runs] = await store.raw<{ total: number; ci: number; local: number }>(
    `SELECT COUNT(*)::INTEGER AS total,
       COUNT(*) FILTER (WHERE source = 'ci')::INTEGER AS ci,
       COUNT(*) FILTER (WHERE source = 'local')::INTEGER AS local
     FROM flaker_v1.runs
     WHERE source <> 'mutation' AND created_at > ?::TIMESTAMP AND created_at <= ?::TIMESTAMP`,
    [since, until],
  );
  const [results] = await store.raw<{ total: number; passed: number; failed: number; tests: number; commits: number }>(
    `SELECT COUNT(*)::INTEGER AS total,
       COUNT(*) FILTER (WHERE r.status = 'passed' AND COALESCE(r.retry_count, 0) = 0)::INTEGER AS passed,
       COUNT(*) FILTER (WHERE r.status IN ('failed', 'flaky') OR (r.status = 'passed' AND r.retry_count > 0))::INTEGER AS failed,
       COUNT(DISTINCT r.test_key)::INTEGER AS tests,
       COUNT(DISTINCT ru.commit_sha)::INTEGER AS commits
     FROM flaker_v1.results r
     JOIN flaker_v1.runs ru ON ru.run_id = r.run_id
     WHERE ru.source <> 'mutation' AND r.created_at > ?::TIMESTAMP AND r.created_at <= ?::TIMESTAMP`,
    [since, until],
  );
  return {
    runs: { total: runs?.total ?? 0, ci: runs?.ci ?? 0, local: runs?.local ?? 0 },
    results: {
      total: results?.total ?? 0, passed: results?.passed ?? 0, failed: results?.failed ?? 0,
      tests: results?.tests ?? 0, commits: results?.commits ?? 0,
    },
  };
}
