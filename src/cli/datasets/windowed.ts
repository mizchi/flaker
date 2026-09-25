// src/cli/datasets/windowed.ts
/**
 * The flaker_v1 facts over an explicit window. `flaker_v1.flaky` and
 * `flaker_v1.co_failures` are these macros at the configured window and now;
 * commands that take `--window-days` (or a fixed `now` in tests) read the same
 * definition through here instead of computing their own.
 */
import type { MetricStore } from "../storage/types.js";
import type { FlakerV1CoFailureRow, FlakerV1FlakyRow } from "../contracts/flaker-v1-datasets.js";
import { FLAKER_V1_SCHEMAS } from "../contracts/flaker-v1-datasets.js";
import { normalizeRow } from "./serialize.js";

export interface WindowOpts {
  windowDays: number;
  /** End of the window; defaults to now. */
  now?: Date;
}

/** A naive-UTC timestamp literal, as stored timestamps are. */
export function naiveUtc(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

export async function readFlakyWindow(
  store: MetricStore,
  opts: WindowOpts & { ciOnly?: boolean },
): Promise<FlakerV1FlakyRow[]> {
  const rows = await store.raw<Record<string, unknown>>(
    `SELECT * FROM flaker_flaky_window(?::INTEGER, ?::TIMESTAMP, ci_only := ?::BOOLEAN) ORDER BY test_key`,
    [opts.windowDays, naiveUtc(opts.now ?? new Date()), opts.ciOnly === true],
  );
  return rows.map((row) => normalizeRow(row, FLAKER_V1_SCHEMAS.flaky) as unknown as FlakerV1FlakyRow);
}

export async function readCoFailuresWindow(store: MetricStore, opts: WindowOpts): Promise<FlakerV1CoFailureRow[]> {
  const rows = await store.raw<Record<string, unknown>>(
    `SELECT * FROM flaker_co_failures_window(?::INTEGER, ?::TIMESTAMP) ORDER BY changed_file, test_key`,
    [opts.windowDays, naiveUtc(opts.now ?? new Date())],
  );
  return rows.map((row) => normalizeRow(row, FLAKER_V1_SCHEMAS.co_failures) as unknown as FlakerV1CoFailureRow);
}

/** Broken: failed every run in the window with no flake evidence (a plain regression). */
export const isBroken = (row: FlakerV1FlakyRow) => row.runs > 0 && row.failures === row.runs && row.flaky_rate === 0;
