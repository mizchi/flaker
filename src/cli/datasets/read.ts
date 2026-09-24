import type { MetricStore } from "../storage/types.js";
import { FLAKER_V1_SCHEMAS } from "../contracts/flaker-v1-datasets.js";
import type { DatasetName } from "./registry.js";
import { prepareDatasetQuery, type DatasetQueryOptions } from "./query.js";
import { normalizeRow } from "./serialize.js";

export async function readDataset(
  store: MetricStore,
  name: DatasetName,
  opts: DatasetQueryOptions = {},
): Promise<Record<string, unknown>[]> {
  const rows = await store.raw<Record<string, unknown>>(await prepareDatasetQuery(store, name, opts));
  return rows.map((row) => normalizeRow(row, FLAKER_V1_SCHEMAS[name]));
}
