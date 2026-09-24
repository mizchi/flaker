// src/cli/selector/ground-truth.ts
import type { MetricStore } from "../storage/types.js";
import type { CalibrationRecord } from "./calibrate-core.js";

export interface UnmatchedFailure {
  selectorRunId: string;
  headSha: string;
  testKey: string;
}

export interface LoadedCalibration {
  records: CalibrationRecord[];
  /** Selector runs with no full run on their head (or no head at all). */
  withoutFullRun: number;
  /** Earlier selector runs on a head that a later run on the same head replaces. */
  superseded: number;
  /** Real failures on a record's head that no verdict of that record names. */
  unmatched: UnmatchedFailure[];
}

/**
 * Real selector runs in the window, one per head (the latest), joined to the
 * failures of a full real run on that head. Mutation selector runs are left
 * out, as in the misses view: they are scored against mutation runs later.
 */
export async function loadCalibrationRecords(
  store: MetricStore,
  opts: { selector: string; since: Date },
): Promise<LoadedCalibration> {
  const since = opts.since.toISOString().replace("T", " ").replace("Z", "");
  const verdictRows = await store.raw<{
    selector_run_id: string; source: "real" | "mutation"; context_digest: string | null; head_sha: string | null;
    test_key: string | null; score: number | null; confidence: number | null; reason: string;
  }>(
    `SELECT selector_run_id, source, context_digest, head_sha, test_key, score, confidence, reason
     FROM flaker_v1.selector_verdicts
     WHERE selector = ? AND source = 'real' AND created_at >= ?::TIMESTAMP`,
    [opts.selector, since],
  );
  const runIds = await store.raw<{ selector_run_id: string; head_sha: string | null; source: "real" | "mutation"; context_digest: string | null }>(
    `SELECT selector_run_id, head_sha, source, context_digest FROM selector_runs
     WHERE selector = ? AND source = 'real' AND created_at >= ?::TIMESTAMP ORDER BY created_at, selector_run_id`,
    [opts.selector, since],
  );
  const fullHeads = new Set((await store.raw<{ commit_sha: string }>(
    `SELECT DISTINCT commit_sha FROM flaker_v1.runs WHERE is_full AND source <> 'mutation'`,
  )).map((r) => r.commit_sha));
  const truth = new Map<string, Set<string>>();
  for (const row of await store.raw<{ commit_sha: string; test_key: string }>(
    `SELECT DISTINCT commit_sha, test_key FROM selector_ground_truth`,
  )) {
    const set = truth.get(row.commit_sha) ?? new Set<string>();
    set.add(row.test_key);
    truth.set(row.commit_sha, set);
  }

  const byRun = new Map<string, CalibrationRecord["verdicts"]>();
  for (const v of verdictRows) {
    const list = byRun.get(v.selector_run_id) ?? [];
    list.push({ testKey: v.test_key, score: v.score, confidence: v.confidence, reason: v.reason });
    byRun.set(v.selector_run_id, list);
  }

  // One record per head: the latest run. Re-running the selector on a commit
  // must not count the same regression once per run.
  const latestByHead = new Map<string, (typeof runIds)[number]>();
  for (const run of runIds) if (run.head_sha !== null) latestByHead.set(run.head_sha, run);
  const kept = runIds.filter((run) => run.head_sha === null || latestByHead.get(run.head_sha) === run);

  const out: LoadedCalibration = { records: [], withoutFullRun: 0, superseded: runIds.length - kept.length, unmatched: [] };
  for (const run of kept) {
    if (run.head_sha === null || !fullHeads.has(run.head_sha)) {
      out.withoutFullRun++;
      continue;
    }
    const verdicts = byRun.get(run.selector_run_id) ?? [];
    const named = new Set(verdicts.map((v) => v.testKey).filter((k): k is string => k !== null));
    const failures: string[] = [];
    for (const key of [...(truth.get(run.head_sha) ?? [])].sort()) {
      if (named.has(key)) failures.push(key);
      else out.unmatched.push({ selectorRunId: run.selector_run_id, headSha: run.head_sha, testKey: key });
    }
    out.records.push({
      selectorRunId: run.selector_run_id, source: run.source, contextDigest: run.context_digest, verdicts, failures,
    });
  }
  return out;
}
