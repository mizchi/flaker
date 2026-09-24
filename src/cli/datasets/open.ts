import { resolve } from "node:path";
import type { FlakerConfig } from "../config.js";
import { DuckDBStore } from "../storage/duckdb.js";
import { datasetSettingsFromConfig, syncDatasetSettings } from "./config-sync.js";

/** Open the store with the dataset settings synced from flaker.toml. Caller closes it. */
export async function openDatasetStore(cwd: string, config: FlakerConfig): Promise<DuckDBStore> {
  const store = new DuckDBStore(resolve(cwd, config.storage.path));
  await store.initialize();
  await syncDatasetSettings(store, datasetSettingsFromConfig(config));
  return store;
}
