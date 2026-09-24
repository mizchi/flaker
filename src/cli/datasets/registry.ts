export const DATASET_NAMES = [
  "tests", "runs", "results", "flaky", "quarantine", "co_failures",
  "selector_verdicts", "misses", "gate_calibration",
] as const;

export type DatasetName = (typeof DATASET_NAMES)[number];

/** The column `--since` filters on; null when the dataset has none. */
export const DATASET_TIME_COLUMN: Record<DatasetName, string | null> = {
  tests: "last_seen_at",
  runs: "created_at",
  results: "created_at",
  flaky: null,
  quarantine: "since",
  co_failures: null,
  selector_verdicts: "created_at",
  misses: null,
  gate_calibration: "calibrated_at",
};

export function isDatasetName(value: string): value is DatasetName {
  return (DATASET_NAMES as readonly string[]).includes(value);
}
