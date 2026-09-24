import type { FlakerConfig } from "../config.js";
import { normalizeWorkflowLanes } from "../config.js";
import type { MetricStore } from "../storage/types.js";

/** The flaker.toml values the flaker_v1 views read, materialized in the database. */
export interface DatasetSettings {
  flakyWindowDays: number;
  flakyThresholdRatio: number;
  coFailureWindowDays: number;
  /** A run with this share of its workflow's recent tests counts as full. */
  fullRunRatio: number;
  fullByLane: Record<string, boolean>;
}

export const FULL_RUN_RATIO = 0.95;
export const DEFAULT_CO_FAILURE_WINDOW_DAYS = 90;

export function datasetSettingsFromConfig(config: FlakerConfig): DatasetSettings {
  return {
    flakyWindowDays: config.flaky.window_days,
    flakyThresholdRatio: config.flaky.detection_threshold_ratio,
    coFailureWindowDays: config.sampling?.co_failure_window_days ?? DEFAULT_CO_FAILURE_WINDOW_DAYS,
    fullRunRatio: FULL_RUN_RATIO,
    fullByLane: normalizeWorkflowLanes(config.workflow_lanes).fullByLane,
  };
}

export async function syncDatasetSettings(store: MetricStore, s: DatasetSettings): Promise<void> {
  await store.raw(
    `INSERT OR REPLACE INTO flaker_dataset_config
       (id, flaky_window_days, flaky_threshold_ratio, co_failure_window_days, full_run_ratio)
     VALUES (1, ?, ?, ?, ?)`,
    [s.flakyWindowDays, s.flakyThresholdRatio, s.coFailureWindowDays, s.fullRunRatio],
  );
  await store.raw(`DELETE FROM flaker_lane_config`);
  for (const [lane, isFull] of Object.entries(s.fullByLane)) {
    await store.raw(`INSERT INTO flaker_lane_config (lane, is_full) VALUES (?, ?)`, [lane, isFull]);
  }
}
