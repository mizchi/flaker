import { FlakerUsageError } from "../errors.js";
import { assertSafeSqlFragment } from "../commands/analyze/sql-guard.js";
import { DATASET_TIME_COLUMN, type DatasetName } from "./registry.js";

export interface DatasetQueryOptions {
  /** ISO date or date-time; rows whose time column is at or after it. */
  since?: string;
  /** SQL condition over the dataset's columns. */
  where?: string;
}

/** A DuckDB TIMESTAMP literal body (naive UTC) for a user-supplied date. */
export function parseSince(raw: string): string {
  const ms = Date.parse(raw);
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw) || Number.isNaN(ms)) {
    throw new FlakerUsageError(`Invalid --since value: ${raw}. Expected an ISO date such as 2026-09-01.`);
  }
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}

/** The SELECT for one dataset. Parameter-free so it can also feed COPY. */
export function buildDatasetQuery(name: DatasetName, opts: DatasetQueryOptions = {}): string {
  const clauses: string[] = [];
  if (opts.since !== undefined) {
    const column = DATASET_TIME_COLUMN[name];
    if (!column) throw new FlakerUsageError(`--since is not supported for ${name}: it has no time column`);
    clauses.push(`${column} >= TIMESTAMP '${parseSince(opts.since)}'`);
  }
  if (opts.where !== undefined) {
    assertSafeSqlFragment(opts.where, "--where");
    clauses.push(`(${opts.where})`);
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  return `SELECT * FROM flaker_v1.${name}${where}`;
}
