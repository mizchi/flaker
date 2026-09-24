import type { MetricStore } from "../../storage/types.js";
import { FlakerUsageError } from "../../errors.js";
import type { DatasetSettings } from "../../datasets/config-sync.js";

/**
 * The longest look-back any command uses by default: `calibrate` and
 * `calibrate --selector` (`--window-days`), `explain insights` / `cluster`.
 */
export const LONGEST_DEFAULT_WINDOW_DAYS = 90;

export interface PruneCounts {
  workflow_runs: number;
  test_results: number;
  collected_artifacts: number;
  commit_changes: number;
  sampling_runs: number;
  sampling_run_tests: number;
  selector_runs: number;
  selector_run_tests: number;
  gate_calibrations: number;
}

export interface PruneResult {
  cutoff: string;
  older_than_days: number;
  min_days: number;
  dry_run: boolean;
  removed: PruneCounts;
}

/**
 * The shortest `--older-than` that leaves every default window whole. A run's
 * `is_full` compares it with its workflow's runs up to the flaky window before
 * it, so the flaky window is added on top of the longest other window.
 */
export function minimumRetentionDays(settings: Pick<DatasetSettings, "flakyWindowDays" | "coFailureWindowDays">): number {
  return Math.max(LONGEST_DEFAULT_WINDOW_DAYS, settings.coFailureWindowDays) + settings.flakyWindowDays;
}

/** Tables other tables reference with a REFERENCES constraint. */
const FK_PARENTS = new Set<keyof PruneCounts>(["workflow_runs", "sampling_runs"]);
const TEMP_TABLES = ["prune_runs", "prune_selector_runs", "prune_commits", "prune_sampling_runs", "prune_gate_calibrations"];

function naiveUtc(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Deletes history older than `olderThanDays`, keeping every table consistent:
 * results and collected artifacts go with their run, selector verdicts with
 * their selector run, and commit changes once no kept run or selector run
 * names the commit. Quarantine, coverage and settings are state, not history,
 * and are kept; so is the latest gate calibration of each selector.
 */
export async function runPrune(opts: {
  store: MetricStore;
  olderThanDays: number;
  settings: Pick<DatasetSettings, "flakyWindowDays" | "coFailureWindowDays">;
  dryRun: boolean;
  now?: Date;
}): Promise<PruneResult> {
  const { store, olderThanDays, dryRun } = opts;
  const minDays = minimumRetentionDays(opts.settings);
  if (!Number.isInteger(olderThanDays) || olderThanDays < minDays) {
    throw new FlakerUsageError(
      `--older-than must be at least ${minDays} days: the flaky window (${opts.settings.flakyWindowDays}) on top of the longest calibration / co-failure window (${Math.max(LONGEST_DEFAULT_WINDOW_DAYS, opts.settings.coFailureWindowDays)})`,
    );
  }
  const now = opts.now ?? new Date();
  const cutoff = naiveUtc(new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000));

  await store.raw(`BEGIN TRANSACTION`);
  try {
    await store.raw(`CREATE OR REPLACE TEMP TABLE prune_runs AS
      SELECT id, commit_sha FROM workflow_runs WHERE created_at < ?::TIMESTAMP`, [cutoff]);
    await store.raw(`CREATE OR REPLACE TEMP TABLE prune_selector_runs AS
      SELECT selector_run_id, head_sha FROM selector_runs WHERE created_at < ?::TIMESTAMP`, [cutoff]);
    // Commits only pruned history names; commit_changes of any other commit stay.
    await store.raw(`CREATE OR REPLACE TEMP TABLE prune_commits AS
      SELECT commit_sha FROM (
        SELECT commit_sha FROM prune_runs
        UNION SELECT head_sha FROM prune_selector_runs WHERE head_sha IS NOT NULL
      )
      EXCEPT (
        SELECT commit_sha FROM workflow_runs WHERE id NOT IN (SELECT id FROM prune_runs)
        UNION SELECT commit_sha FROM test_results
          WHERE workflow_run_id IS NULL OR workflow_run_id NOT IN (SELECT id FROM prune_runs)
        UNION SELECT head_sha FROM selector_runs
          WHERE head_sha IS NOT NULL AND selector_run_id NOT IN (SELECT selector_run_id FROM prune_selector_runs)
      )`);
    await store.raw(`CREATE OR REPLACE TEMP TABLE prune_sampling_runs AS
      SELECT id FROM sampling_runs WHERE created_at < ?::TIMESTAMP`, [cutoff]);
    await store.raw(`CREATE OR REPLACE TEMP TABLE prune_gate_calibrations AS
      SELECT selector, calibrated_at FROM gate_calibrations g
      WHERE calibrated_at < ?::TIMESTAMP
        AND calibrated_at < (SELECT MAX(calibrated_at) FROM gate_calibrations l WHERE l.selector = g.selector)`, [cutoff]);

    const targets: Record<keyof PruneCounts, string> = {
      test_results: `FROM test_results WHERE workflow_run_id IN (SELECT id FROM prune_runs)`,
      collected_artifacts: `FROM collected_artifacts WHERE workflow_run_id IN (SELECT id FROM prune_runs)`,
      workflow_runs: `FROM workflow_runs WHERE id IN (SELECT id FROM prune_runs)`,
      commit_changes: `FROM commit_changes WHERE commit_sha IN (SELECT commit_sha FROM prune_commits)`,
      sampling_run_tests: `FROM sampling_run_tests WHERE sampling_run_id IN (SELECT id FROM prune_sampling_runs)`,
      sampling_runs: `FROM sampling_runs WHERE id IN (SELECT id FROM prune_sampling_runs)`,
      selector_run_tests: `FROM selector_run_tests WHERE selector_run_id IN (SELECT selector_run_id FROM prune_selector_runs)`,
      selector_runs: `FROM selector_runs WHERE selector_run_id IN (SELECT selector_run_id FROM prune_selector_runs)`,
      gate_calibrations: `FROM gate_calibrations g WHERE EXISTS (
        SELECT 1 FROM prune_gate_calibrations p WHERE p.selector = g.selector AND p.calibrated_at = g.calibrated_at)`,
    };
    const removed = {} as PruneCounts;
    for (const [table, from] of Object.entries(targets) as Array<[keyof PruneCounts, string]>) {
      const [row] = await store.raw<{ n: number }>(`SELECT COUNT(*)::INTEGER AS n ${from}`);
      removed[table] = row.n;
    }
    if (dryRun) {
      await store.raw(`ROLLBACK`);
      return { cutoff, older_than_days: olderThanDays, min_days: minDays, dry_run: true, removed };
    }
    // DuckDB refuses to delete a referenced parent in the transaction that
    // deleted its children (a documented foreign-key limitation), so children,
    // and tables no constraint names, are committed first. An interrupted
    // prune leaves only childless runs, which the next prune removes.
    for (const table of Object.keys(targets) as Array<keyof PruneCounts>) {
      if (!FK_PARENTS.has(table) && removed[table] > 0) await store.raw(`DELETE ${targets[table]}`);
    }
    await store.raw(`COMMIT`);
    await store.raw(`BEGIN TRANSACTION`);
    for (const table of FK_PARENTS) {
      if (removed[table] > 0) await store.raw(`DELETE ${targets[table]}`);
    }
    await store.raw(`COMMIT`);
    await store.raw(`CHECKPOINT`);
    return { cutoff, older_than_days: olderThanDays, min_days: minDays, dry_run: false, removed };
  } catch (error) {
    await store.raw(`ROLLBACK`).catch(() => {});
    throw error;
  } finally {
    for (const temp of TEMP_TABLES) await store.raw(`DROP TABLE IF EXISTS ${temp}`).catch(() => {});
  }
}

export function formatPruneReport(result: PruneResult): string {
  const lines = [
    `${result.dry_run ? "Would remove" : "Removed"} history before ${result.cutoff} UTC (older than ${result.older_than_days} days):`,
  ];
  const width = Math.max(...Object.keys(result.removed).map((k) => k.length));
  for (const [table, n] of Object.entries(result.removed)) {
    lines.push(`  ${table.padEnd(width)}  ${n}`);
  }
  if (result.dry_run) lines.push("Dry run: nothing was deleted.");
  return lines.join("\n");
}
