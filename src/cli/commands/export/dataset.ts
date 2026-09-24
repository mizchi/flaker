import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DuckDBStore } from "../../storage/duckdb.js";
import { FlakerUsageError } from "../../errors.js";
import { DATASET_NAMES, isDatasetName } from "../../datasets/registry.js";
import { EXPORT_FORMATS, formatRows, isExportFormat } from "../../datasets/format.js";
import { prepareDatasetQuery } from "../../datasets/query.js";
import { readDataset } from "../../datasets/read.js";
import { FLAKER_V1_SCHEMAS } from "../../contracts/flaker-v1-datasets.js";

export interface ExportDatasetOpts {
  store: DuckDBStore;
  dataset: string;
  format: string;
  since?: string;
  where?: string;
  output?: string;
}

export interface ExportDatasetResult {
  rows: number;
  /** The rendered output when no `output` file was given; null otherwise. */
  text: string | null;
}

export async function runExportDataset(opts: ExportDatasetOpts): Promise<ExportDatasetResult> {
  const { store, dataset, format } = opts;
  if (!isDatasetName(dataset)) {
    throw new FlakerUsageError(`Unknown dataset "${dataset}". Expected one of: ${DATASET_NAMES.join(", ")}`);
  }
  if (!isExportFormat(format)) {
    throw new FlakerUsageError(`Unknown format "${format}". Expected one of: ${EXPORT_FORMATS.join(", ")}`);
  }
  const filter = { since: opts.since, where: opts.where };
  if (format === "parquet") {
    if (!opts.output) throw new FlakerUsageError("--format parquet requires -o <file>");
    const sql = await prepareDatasetQuery(store, dataset, filter);
    const output = resolve(opts.output);
    mkdirSync(dirname(output), { recursive: true });
    // Even if a --where grammar slipped past the guard, it cannot touch files.
    await store.disableExternalAccess([output]);
    await store.copySelectToParquet(sql, output);
    const [count] = await store.raw<{ n: number }>(`SELECT COUNT(*)::INTEGER AS n FROM (${sql})`);
    return { rows: count?.n ?? 0, text: null };
  }
  await store.disableExternalAccess();
  const rows = await readDataset(store, dataset, filter);
  const columns = Object.keys((FLAKER_V1_SCHEMAS[dataset] as { properties: object }).properties);
  const text = formatRows(rows, format, columns);
  if (opts.output) {
    const path = resolve(opts.output);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
    return { rows: rows.length, text: null };
  }
  return { rows: rows.length, text };
}
