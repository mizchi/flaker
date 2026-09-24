// src/cli/datasets/read.ts
import type { MetricStore } from "../storage/types.js";
import { FLAKER_V1_SCHEMAS } from "../contracts/flaker-v1-datasets.js";
import type { DatasetName } from "./registry.js";
import { normalizeRow } from "./serialize.js";

export async function readDataset(
  store: MetricStore,
  name: DatasetName,
): Promise<Record<string, unknown>[]> {
  const rows = await store.raw<Record<string, unknown>>(`SELECT * FROM flaker_v1.${name}`);
  return rows.map((row) => normalizeRow(row, FLAKER_V1_SCHEMAS[name]));
}
