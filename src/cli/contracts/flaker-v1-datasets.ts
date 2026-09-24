// src/cli/contracts/flaker-v1-datasets.ts
/**
 * Row contracts of the public datasets (DuckDB schema `flaker_v1`), as
 * `flaker export <dataset> --format json` emits them: timestamps as ISO
 * strings, JSON columns as values. Within v1 only column additions are
 * allowed, so every schema has `additionalProperties: true`.
 */
import {
  BOOL, INT, INT_OR_NULL, NUM, NUM_OR_NULL, STR, STR_OR_NULL, STRINGS, TIME, TIME_OR_NULL, oneOf,
  type JsonSchema,
} from "./json-schema.js";
import type { DatasetName } from "../datasets/registry.js";

export interface FlakerV1TestRow {
  test_key: string; suite: string; test_name: string; task_id: string;
  variant: Record<string, string> | null; file: string; title_path: string[];
  first_seen_at: string; last_seen_at: string;
}
export interface FlakerV1RunRow {
  run_id: number; source: "ci" | "local" | "mutation"; workflow_name: string | null; lane: string | null;
  commit_sha: string; branch: string | null; event: string | null; is_full: boolean; created_at: string | null;
}
export interface FlakerV1ResultRow {
  run_id: number; test_key: string; status: string; retry_count: number | null;
  duration_ms: number | null; created_at: string | null;
}
export interface FlakerV1FlakyRow {
  test_key: string; window_days: number; runs: number; failures: number;
  flaky_rate: number; is_flaky: boolean; computed_at: string;
}
export interface FlakerV1QuarantineRow {
  test_key: string; reason: string; since: string | null; source: "auto" | "manual";
}
export interface FlakerV1CoFailureRow {
  changed_file: string; test_key: string; co_failures: number; changes: number; strength: number; window_days: number;
}
export interface FlakerV1SelectorVerdictRow {
  selector_run_id: string; selector: string; selector_version: string | null;
  head_sha: string | null; base_sha: string | null; context_digest: string | null;
  source: "real" | "mutation"; test_key: string | null; file: string; title_path: string[];
  project: string | null; score: number | null; confidence: number | null; reason: string;
  selected: boolean; created_at: string;
}
export interface FlakerV1MissRow {
  selector_run_id: string; test_key: string; head_sha: string; ci_run_id: number;
  reason: string; changed_files: string[];
}
export interface FlakerV1GateCalibrationRow {
  selector: string; calibrated_at: string; cutoff: number; unsure_below: number; unsure_margin: number;
  records: number; real_failures: number; recall_lb95: number | null;
  decision: "tighten" | "loosen" | "keep"; rationale: string;
}

function datasetRow(name: DatasetName, description: string, properties: Record<string, JsonSchema>): JsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://github.com/mizchi/flaker/contracts/flaker_v1/${name}.json`,
    title: `flaker_v1.${name}`,
    description,
    type: "object",
    required: Object.keys(properties),
    properties,
    additionalProperties: true,
  };
}

const VARIANT: JsonSchema = { type: ["object", "null"], additionalProperties: { type: "string" } };

// Property order is the view's column order; a contract test pins both.
export const FLAKER_V1_SCHEMAS: Record<DatasetName, JsonSchema> = {
  tests: datasetRow("tests", "Test identity. file + title_path is what selectors match on.", {
    test_key: STR, suite: STR, test_name: STR, task_id: STR, variant: VARIANT, file: STR,
    title_path: STRINGS, first_seen_at: TIME, last_seen_at: TIME,
  }),
  runs: datasetRow("runs", "One execution. is_full says whether the whole suite ran.", {
    run_id: INT, source: oneOf("ci", "local", "mutation"), workflow_name: STR_OR_NULL, lane: STR_OR_NULL,
    commit_sha: STR, branch: STR_OR_NULL, event: STR_OR_NULL, is_full: BOOL, created_at: TIME_OR_NULL,
  }),
  results: datasetRow("results", "Per-test results.", {
    run_id: INT, test_key: STR, status: STR, retry_count: INT_OR_NULL, duration_ms: INT_OR_NULL,
    created_at: TIME_OR_NULL,
  }),
  flaky: datasetRow("flaky", "Flaky verdicts over the configured window.", {
    test_key: STR, window_days: INT, runs: INT, failures: INT, flaky_rate: NUM, is_flaky: BOOL,
    computed_at: TIME,
  }),
  quarantine: datasetRow("quarantine", "Quarantined tests.", {
    test_key: STR, reason: STR, since: TIME_OR_NULL, source: oneOf("auto", "manual"),
  }),
  co_failures: datasetRow("co_failures", "How often a test failed on commits that changed a file.", {
    changed_file: STR, test_key: STR, co_failures: INT, changes: INT, strength: NUM, window_days: INT,
  }),
  selector_verdicts: datasetRow("selector_verdicts", "A selector's per-test decisions.", {
    selector_run_id: STR, selector: STR, selector_version: STR_OR_NULL, head_sha: STR_OR_NULL,
    base_sha: STR_OR_NULL, context_digest: STR_OR_NULL, source: oneOf("real", "mutation"),
    test_key: STR_OR_NULL, file: STR, title_path: STRINGS, project: STR_OR_NULL, score: NUM_OR_NULL,
    confidence: NUM_OR_NULL, reason: STR, selected: BOOL, created_at: TIME,
  }),
  misses: datasetRow("misses", "Tests the selector did not select that failed in a full run.", {
    selector_run_id: STR, test_key: STR, head_sha: STR, ci_run_id: INT, reason: STR, changed_files: STRINGS,
  }),
  gate_calibration: datasetRow("gate_calibration", "Calibration history; the latest row per selector is current.", {
    selector: STR, calibrated_at: TIME, cutoff: NUM, unsure_below: NUM, unsure_margin: NUM, records: INT,
    real_failures: INT, recall_lb95: NUM_OR_NULL, decision: oneOf("tighten", "loosen", "keep"), rationale: STR,
  }),
};
