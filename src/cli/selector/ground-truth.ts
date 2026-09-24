// src/cli/selector/ground-truth.ts
import type { MetricStore } from "../storage/types.js";
import type { CalibrationRecord } from "./calibrate-core.js";

export interface UnmatchedFailure {
  selectorRunId: string;
  headSha: string;
  testKey: string;
}

export interface LoadedCalibration {
  /** Real records first, then mutation records. */
  records: CalibrationRecord[];
  /** Selector runs with no full run on their head (or no head at all). */
  withoutFullRun: number;
  /** Earlier selector runs on a head that a later run on the same head replaces. */
  superseded: number;
  /** Real failures on a record's head that no verdict of that record names. */
  unmatched: UnmatchedFailure[];
  mutation: MutationEvidence;
}

export interface MutationEvidence {
  /** Mutation records scored against their trial. */
  records: number;
  /** Tests the trials killed that the records name. */
  failures: number;
  /** Mutation selector runs whose head is no trial of this database. */
  withoutTrial: number;
  /** Killed tests no verdict of the record names. */
  unmatched: number;
}

/**
 * Real selector runs in the window, one per head (the latest), joined to the
 * failures of a full real run on that head; and mutation selector runs, one
 * per trial, joined to the tests that trial killed. Flaky and quarantined
 * tests are ground truth for neither.
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

  const out: LoadedCalibration = {
    records: [], withoutFullRun: 0, superseded: runIds.length - kept.length, unmatched: [],
    mutation: { records: 0, failures: 0, withoutTrial: 0, unmatched: 0 },
  };
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
  out.records.push(...await loadMutationRecords(store, opts.selector, since, out.mutation));
  return out;
}

async function loadMutationRecords(
  store: MetricStore,
  selector: string,
  since: string,
  evidence: MutationEvidence,
): Promise<CalibrationRecord[]> {
  const runs = await store.raw<{ selector_run_id: string; head_sha: string | null; context_digest: string | null; trial: bigint | number | null }>(
    `SELECT sr.selector_run_id, sr.head_sha, sr.context_digest,
       (SELECT MAX(mt.run_id) FROM mutation_trials mt WHERE mt.commit_sha = sr.head_sha) AS trial
     FROM selector_runs sr
     WHERE sr.selector = ? AND sr.source = 'mutation' AND sr.created_at >= ?::TIMESTAMP
     ORDER BY sr.created_at, sr.selector_run_id`,
    [selector, since],
  );
  if (runs.length === 0) return [];
  const verdictRows = await store.raw<{ selector_run_id: string; test_key: string | null; score: number | null; confidence: number | null; reason: string }>(
    `SELECT selector_run_id, test_key, score, confidence, reason
     FROM flaker_v1.selector_verdicts
     WHERE selector = ? AND source = 'mutation' AND created_at >= ?::TIMESTAMP`,
    [selector, since],
  );
  const kills = new Map<number, string[]>();
  for (const row of await store.raw<{ run_id: bigint | number; test_id: string }>(
    `SELECT run_id, test_id FROM mutation_failures
     WHERE test_id NOT IN (SELECT test_key FROM flaker_v1.flaky WHERE is_flaky)
       AND test_id NOT IN (SELECT test_key FROM flaker_v1.quarantine)
     ORDER BY test_id`,
  )) {
    const list = kills.get(Number(row.run_id)) ?? [];
    list.push(row.test_id);
    kills.set(Number(row.run_id), list);
  }
  const byRun = new Map<string, CalibrationRecord["verdicts"]>();
  for (const v of verdictRows) {
    const list = byRun.get(v.selector_run_id) ?? [];
    list.push({ testKey: v.test_key, score: v.score, confidence: v.confidence, reason: v.reason });
    byRun.set(v.selector_run_id, list);
  }
  // One record per trial, the latest.
  const latest = new Map<number, (typeof runs)[number]>();
  for (const run of runs) {
    if (run.trial === null) evidence.withoutTrial++;
    else latest.set(Number(run.trial), run);
  }
  const records: CalibrationRecord[] = [];
  for (const [trial, run] of [...latest.entries()].sort((a, b) => a[0] - b[0])) {
    const verdicts = byRun.get(run.selector_run_id) ?? [];
    const named = new Set(verdicts.map((v) => v.testKey).filter((k): k is string => k !== null));
    const failures = (kills.get(trial) ?? []).filter((key) => {
      if (named.has(key)) return true;
      evidence.unmatched++;
      return false;
    });
    evidence.records++;
    evidence.failures += failures.length;
    records.push({ selectorRunId: run.selector_run_id, source: "mutation", contextDigest: run.context_digest, verdicts, failures });
  }
  return records;
}
