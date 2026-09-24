// tests/datasets/config-sync.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import {
  datasetSettingsFromConfig,
  syncDatasetSettings,
} from "../../src/cli/datasets/config-sync.js";
import type { FlakerConfig } from "../../src/cli/config.js";

describe("dataset settings", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });
  afterEach(async () => {
    await store.close();
  });

  it("has defaults before any sync", async () => {
    const [row] = await store.raw<Record<string, number>>(`SELECT * FROM flaker_dataset_config`);
    expect(row).toMatchObject({
      id: 1, flaky_window_days: 14, flaky_threshold_ratio: 0.02,
      co_failure_window_days: 90, full_run_ratio: 0.95,
    });
  });

  it("derives settings from flaker.toml values", () => {
    const config = {
      flaky: { window_days: 7, detection_threshold_ratio: 0.1 },
      sampling: { strategy: "hybrid", co_failure_window_days: 30 },
      workflow_lanes: { "nightly.yml": { lane: "full-batch", full: true } },
    } as unknown as FlakerConfig;
    expect(datasetSettingsFromConfig(config)).toEqual({
      flakyWindowDays: 7,
      flakyThresholdRatio: 0.1,
      coFailureWindowDays: 30,
      fullRunRatio: 0.95,
      fullByLane: { "full-batch": true },
    });
  });

  it("replaces the single settings row and the lane table", async () => {
    const base = { flakyWindowDays: 7, flakyThresholdRatio: 0.1, coFailureWindowDays: 30, fullRunRatio: 0.95 };
    await syncDatasetSettings(store, { ...base, fullByLane: { a: true, b: false } });
    await syncDatasetSettings(store, { ...base, fullByLane: { c: true } });
    const cfg = await store.raw<{ n: number }>(`SELECT COUNT(*)::INTEGER AS n FROM flaker_dataset_config`);
    expect(cfg[0].n).toBe(1);
    const lanes = await store.raw<{ lane: string; is_full: boolean }>(
      `SELECT lane, is_full FROM flaker_lane_config ORDER BY lane`,
    );
    expect(lanes).toEqual([{ lane: "c", is_full: true }]);
  });
});
