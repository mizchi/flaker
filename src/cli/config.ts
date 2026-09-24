import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";
import { FlakerUsageError } from "./errors.js";
import { LEGACY_PROFILE_TO_GATE, VALID_GATE_NAMES, type GateName } from "./gate.js";

export interface SamplingConfig {
  strategy: string;
  sample_percentage?: number;           // was `percentage`
  holdout_ratio?: number;
  co_failure_window_days?: number;      // was `co_failure_days`
  skip_quarantined?: boolean;
  skip_flaky_tagged?: boolean;
  calibrated_at?: string;
  detected_flaky_rate_ratio?: number;   // was `detected_flaky_rate`
  detected_co_failure_strength_ratio?: number;  // was `detected_co_failure_strength`
  detected_test_count?: number;
}

export interface GateConfig {
  strategy: string;
  sample_percentage?: number;           // was `percentage`
  holdout_ratio?: number;
  co_failure_window_days?: number;      // was `co_failure_days`
  skip_quarantined?: boolean;
  skip_flaky_tagged?: boolean;
  max_duration_seconds?: number;
  fallback_strategy?: string;
}

export interface PromotionThresholds {
  matched_commits_min: number;
  false_negative_rate_max_percentage: number;
  pass_correlation_min_percentage: number;
  holdout_fnr_max_percentage: number;
  data_confidence_min: "low" | "moderate" | "high";
}

export const DEFAULT_PROMOTION: PromotionThresholds = {
  matched_commits_min: 20,
  false_negative_rate_max_percentage: 5,
  pass_correlation_min_percentage: 95,
  holdout_fnr_max_percentage: 10,
  data_confidence_min: "moderate",
};

export type WorkflowLaneEntry = string | { lane: string; full?: boolean };

export interface NormalizedWorkflowLanes {
  /** workflow name or path → lane */
  lanes: Record<string, string>;
  /** lane → whether its runs are full runs; absent when not configured */
  fullByLane: Record<string, boolean>;
}

export function normalizeWorkflowLanes(
  raw: Record<string, WorkflowLaneEntry> | undefined,
): NormalizedWorkflowLanes {
  const lanes: Record<string, string> = {};
  const fullByLane: Record<string, boolean> = {};
  for (const [workflow, entry] of Object.entries(raw ?? {})) {
    if (typeof entry === "string") {
      lanes[workflow] = entry;
      continue;
    }
    if (!isTable(entry) || typeof entry.lane !== "string" || entry.lane === "") {
      throw new FlakerUsageError(
        `[workflow_lanes] "${workflow}" must be a lane name or { lane = "<name>", full = true|false }`,
      );
    }
    lanes[workflow] = entry.lane;
    if (entry.full === undefined) continue;
    if (typeof entry.full !== "boolean") {
      throw new FlakerUsageError(`[workflow_lanes] "${workflow}".full must be true or false`);
    }
    const previous = fullByLane[entry.lane];
    if (previous !== undefined && previous !== entry.full) {
      throw new FlakerUsageError(`[workflow_lanes] lane "${entry.lane}" has conflicting full values`);
    }
    fullByLane[entry.lane] = entry.full;
  }
  return { lanes, fullByLane };
}

export interface FlakerConfig {
  repo: { owner: string; name: string };
  storage: { path: string };
  collect?: { workflow_paths?: string[] };
  /**
   * Optional GitHub-Actions workflow-name → lane mapping, applied at collect/import
   * time. A value is either the lane name, or `{ lane = "<name>", full = true|false }`
   * to also say whether runs in that lane execute the whole suite
   * (`flaker_v1.runs.is_full`). A lane without `full` is judged by result count.
   */
  workflow_lanes?: Record<string, WorkflowLaneEntry>;
  adapter: { type: string; command?: string; artifact_name?: string };
  runner: {
    type: string;
    command: string;
    execute?: string;
    list?: string;
    flaky_tag_pattern?: string;
    actrun?: { workflow?: string; job?: string; local?: boolean; trust?: boolean };
  };
  affected: { resolver: string; config: string };
  quarantine: {
    auto: boolean;
    flaky_rate_threshold_percentage: number;
    min_runs: number;
    manifest?: string;
    task_id?: string;
    runtime_apply?: boolean;
  };
  flaky: { window_days: number; detection_threshold_ratio: number };
  sampling?: SamplingConfig;
  gate?: Partial<Record<GateName, GateConfig>>;
  promotion: PromotionThresholds;
  selector?: Partial<SelectorConfig>;
}

export interface SelectorConfig {
  type: "jev";
  /** Loosening needs the Wilson 95% lower bound of recall to reach this. */
  recall_target: number;
  /** Loosening needs at least this many real (non-mutation) failures. */
  min_failures: number;
  /** jev-context carries hints for at most this many tests. */
  max_hinted_tests: number;
}

export const DEFAULT_SELECTOR: SelectorConfig = {
  type: "jev",
  recall_target: 0.9,
  min_failures: 20,
  max_hinted_tests: 200,
};

export function resolveSelectorConfig(config: FlakerConfig): SelectorConfig {
  const merged = { ...DEFAULT_SELECTOR, ...(config.selector ?? {}) };
  if (merged.type !== "jev") {
    throw new FlakerUsageError(`[selector] type "${String(merged.type)}" is not supported; the only selector is "jev"`);
  }
  return merged;
}

export type ConfigWarningCode =
  | "legacy-threshold-unit"
  | "out-of-range-threshold";

export interface ConfigWarning {
  code: ConfigWarningCode;
  path: string;
  value: number;
  normalizedValue?: number;
}

export interface LoadedConfigDiagnostics {
  config: FlakerConfig;
  warnings: ConfigWarning[];
}

const DEFAULT_CONFIG: FlakerConfig = {
  repo: { owner: "", name: "" },
  storage: { path: ".flaker/data" },
  collect: { workflow_paths: [] },
  adapter: { type: "playwright" },
  runner: { type: "vitest", command: "pnpm test" },
  affected: { resolver: "git", config: "" },
  quarantine: { auto: true, flaky_rate_threshold_percentage: 30, min_runs: 5 },
  flaky: { window_days: 14, detection_threshold_ratio: 0.02 },
  promotion: DEFAULT_PROMOTION,
};

function looksLikeWorkflowPath(value?: string): boolean {
  return typeof value === "string"
    && value.trim().length > 0
    && !/\s/.test(value)
    && /\.ya?ml$/i.test(value);
}

function deepMerge<T>(target: T, source: Record<string, unknown>): T {
  const result = { ...(target as Record<string, unknown>) };
  for (const key of Object.keys(source)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const sv = source[key];
    const tv = result[key];
    if (
      sv !== null &&
      typeof sv === "object" &&
      !Array.isArray(sv) &&
      tv !== null &&
      typeof tv === "object" &&
      !Array.isArray(tv)
    ) {
      result[key] = deepMerge(
        tv as Record<string, unknown>,
        sv as Record<string, unknown>,
      );
    } else {
      result[key] = sv;
    }
  }
  return result as T;
}

interface LegacyKeyEntry {
  section: string;
  oldKey: string;
  newKey: string;
  unitNote: string;
}

const LEGACY_KEYS: LegacyKeyEntry[] = [
  { section: "sampling", oldKey: "percentage", newKey: "sample_percentage", unitNote: "value range 0-100" },
  { section: "sampling", oldKey: "co_failure_days", newKey: "co_failure_window_days", unitNote: "days (int)" },
  { section: "sampling", oldKey: "detected_flaky_rate", newKey: "detected_flaky_rate_ratio", unitNote: "0.0-1.0" },
  { section: "sampling", oldKey: "detected_co_failure_strength", newKey: "detected_co_failure_strength_ratio", unitNote: "0.0-1.0" },
  { section: "flaky", oldKey: "detection_threshold", newKey: "detection_threshold_ratio", unitNote: "0.0-1.0" },
  { section: "quarantine", oldKey: "flaky_rate_threshold", newKey: "flaky_rate_threshold_percentage", unitNote: "value range 0-100" },
];

const LEGACY_GATE_KEYS: LegacyKeyEntry[] = [
  { section: "gate.*", oldKey: "percentage", newKey: "sample_percentage", unitNote: "value range 0-100" },
  { section: "gate.*", oldKey: "co_failure_days", newKey: "co_failure_window_days", unitNote: "days (int)" },
];

const REMOVED_IN_0_13 = [
  "cluster_mode",
  "model_path",
  "adaptive",
  "adaptive_fnr_low_ratio",
  "adaptive_fnr_high_ratio",
  "adaptive_min_percentage",
  "adaptive_step",
  "adaptive_fnr_low",
  "adaptive_fnr_high",
] as const;
const REMOVED_STRATEGIES = new Set(["random", "gbdt", "coverage-guided"]);

function checkRemovedKeys(sectionLabel: string, section: Record<string, unknown>, errors: string[]): void {
  for (const key of REMOVED_IN_0_13) {
    if (key in section) errors.push(`\`${key}\` in [${sectionLabel}] was removed in 0.13.0; delete this key`);
  }
  const strategy = section["strategy"];
  if (typeof strategy === "string" && REMOVED_STRATEGIES.has(strategy)) {
    errors.push(`strategy "${strategy}" in [${sectionLabel}] was removed in 0.13.0; use weighted, affected, hybrid or full`);
  }
  const fallback = section["fallback_strategy"];
  if (typeof fallback === "string" && REMOVED_STRATEGIES.has(fallback)) {
    errors.push(`fallback_strategy "${fallback}" in [${sectionLabel}] was removed in 0.13.0; use weighted, affected, hybrid or full`);
  }
}

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkLegacyKeys(parsed: Record<string, unknown>): void {
  const errors: string[] = [];

  if ("profile" in parsed) {
    const legacyProfiles = parsed.profile;
    const names = isTable(legacyProfiles) ? Object.keys(legacyProfiles) : [];
    if (names.length === 0) {
      errors.push("[profile] is no longer supported; use [gate.iteration], [gate.merge], [gate.release]");
    }
    for (const name of names) {
      const gate = LEGACY_PROFILE_TO_GATE[name];
      errors.push(
        gate
          ? `[profile.${name}] was renamed to [gate.${gate}]`
          : `[profile.${name}] has no gate equivalent; use one of [gate.iteration], [gate.merge], [gate.release]`,
      );
    }
  }
  if ("gate" in parsed) {
    const gates = parsed.gate;
    if (!isTable(gates)) {
      errors.push("`gate` must be a table ([gate.iteration], [gate.merge], [gate.release])");
    } else {
      for (const [name, value] of Object.entries(gates)) {
        if (!(VALID_GATE_NAMES as readonly string[]).includes(name)) {
          errors.push(`[gate.${name}] is not a gate; use one of iteration, merge, release`);
        } else if (!isTable(value)) {
          errors.push(`\`gate.${name}\` must be a table ([gate.${name}])`);
        } else {
          checkRemovedKeys(`gate.${name}`, value, errors);
        }
      }
    }
  }

  if (isTable(parsed.sampling)) {
    checkRemovedKeys("sampling", parsed.sampling, errors);
  }
  if ("coverage" in parsed) {
    errors.push("[coverage] was removed in 0.13.0; delete this section");
  }

  for (const entry of LEGACY_KEYS) {
    const section = parsed[entry.section];
    if (section && typeof section === "object" && entry.oldKey in (section as Record<string, unknown>)) {
      errors.push(
        `deprecated key \`${entry.oldKey}\` in [${entry.section}] → rename to \`${entry.newKey}\` (${entry.unitNote})`
      );
    }
  }

  const gateSections = parsed.gate as Record<string, unknown> | undefined;
  if (gateSections && typeof gateSections === "object") {
    for (const [gateName, gateValue] of Object.entries(gateSections)) {
      if (!gateValue || typeof gateValue !== "object") continue;
      for (const entry of LEGACY_GATE_KEYS) {
        if (entry.oldKey in (gateValue as Record<string, unknown>)) {
          errors.push(
            `deprecated key \`${entry.oldKey}\` in [gate.${gateName}] → rename to \`${entry.newKey}\` (${entry.unitNote})`
          );
        }
      }
    }
  }

  if (isTable(parsed.selector)) {
    for (const key of ["cutoff", "unsure_below", "unsure_margin"]) {
      if (key in parsed.selector) {
        errors.push(`[selector] ${key} is not kept in flaker.toml; gate values live in the gate_calibration dataset (run \`flaker calibrate --selector\`)`);
      }
    }
  }

  if (errors.length > 0) {
    throw new FlakerUsageError(
      `flaker.toml uses removed or renamed keys (see docs/migration-0.12-to-0.13.md and docs/how-to-use.md#config-migration):\n` +
      errors.map((e) => `  ${e}`).join("\n")
    );
  }
}

export function loadConfig(dir: string): FlakerConfig {
  return loadConfigWithDiagnostics(dir).config;
}

export function loadConfigWithDiagnostics(dir: string): LoadedConfigDiagnostics {
  const filePath = join(dir, "flaker.toml");
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(`Config file not found: ${filePath}. Run 'flaker init' to create one.`);
  }
  const parsed = parse(content) as unknown as Record<string, unknown>;
  checkLegacyKeys(parsed);
  const config = deepMerge(DEFAULT_CONFIG, parsed);
  // Fail on load, not later in collect or export, when a lane entry is malformed.
  normalizeWorkflowLanes(config.workflow_lanes);
  return { config, warnings: [] };
}

export function formatConfigWarning(warning: ConfigWarning): string {
  switch (warning.code) {
    case "legacy-threshold-unit":
      return `${warning.path}=${warning.value} looks like a legacy ratio; interpreted as ${warning.normalizedValue}%`;
    case "out-of-range-threshold":
      return `${warning.path}=${warning.value} is outside the expected 0-100% range`;
  }
}

export function resolveActrunWorkflowPath(config: FlakerConfig): string {
  const configured = config.runner.actrun?.workflow?.trim();
  if (configured) return configured;

  const fallback = config.runner.command?.trim();
  if (looksLikeWorkflowPath(fallback)) {
    return fallback;
  }

  throw new Error(
    "actrun runner requires [runner.actrun] workflow = \".github/workflows/ci.yml\". "
      + "[runner].command remains the direct runner shell command.",
  );
}

export interface ConfigRangeError {
  path: string;
  value: number | string;
  expected: string;
}

export function validateConfigRanges(config: FlakerConfig): ConfigRangeError[] {
  const errors: ConfigRangeError[] = [];
  const check = (path: string, value: number | undefined, min: number, max: number, label: string) => {
    if (value == null) return;
    if (typeof value !== "number" || Number.isNaN(value)) return;
    if (value < min || value > max) {
      errors.push({ path, value, expected: label });
    }
  };

  check("flaky.detection_threshold_ratio", config.flaky.detection_threshold_ratio, 0, 1, "0.0-1.0");
  check("quarantine.flaky_rate_threshold_percentage", config.quarantine.flaky_rate_threshold_percentage, 0, 100, "0-100");

  if (config.sampling) {
    check("sampling.sample_percentage", config.sampling.sample_percentage, 0, 100, "0-100");
    check("sampling.holdout_ratio", config.sampling.holdout_ratio, 0, 1, "0.0-1.0");
    check("sampling.detected_flaky_rate_ratio", config.sampling.detected_flaky_rate_ratio, 0, 1, "0.0-1.0");
    check("sampling.detected_co_failure_strength_ratio", config.sampling.detected_co_failure_strength_ratio, 0, 1, "0.0-1.0");
  }

  if (config.gate) {
    for (const [name, p] of Object.entries(config.gate)) {
      if (!p) continue;
      check(`gate.${name}.sample_percentage`, p.sample_percentage, 0, 100, "0-100");
      check(`gate.${name}.holdout_ratio`, p.holdout_ratio, 0, 1, "0.0-1.0");
    }
  }

  check("promotion.matched_commits_min", config.promotion.matched_commits_min, 0, Number.MAX_SAFE_INTEGER, ">=0");
  check("promotion.false_negative_rate_max_percentage", config.promotion.false_negative_rate_max_percentage, 0, 100, "0-100");
  check("promotion.pass_correlation_min_percentage", config.promotion.pass_correlation_min_percentage, 0, 100, "0-100");
  check("promotion.holdout_fnr_max_percentage", config.promotion.holdout_fnr_max_percentage, 0, 100, "0-100");

  if (config.selector) {
    check("selector.recall_target", config.selector.recall_target, 0, 1, "0.0-1.0");
    for (const key of ["min_failures", "max_hinted_tests"] as const) {
      const value = config.selector[key];
      if (typeof value === "number" && !Number.isInteger(value)) {
        errors.push({ path: `selector.${key}`, value, expected: "an integer >=0" });
      } else {
        check(`selector.${key}`, value, 0, Number.MAX_SAFE_INTEGER, ">=0");
      }
    }
  }

  try {
    normalizeWorkflowLanes(config.workflow_lanes);
  } catch (error) {
    if (!(error instanceof FlakerUsageError)) throw error;
    errors.push({ path: "workflow_lanes", value: error.message, expected: "a lane name or { lane, full }" });
  }

  const validConfidence = new Set(["low", "moderate", "high"]);
  if (!validConfidence.has(config.promotion.data_confidence_min)) {
    errors.push({
      path: "promotion.data_confidence_min",
      value: config.promotion.data_confidence_min,
      expected: "one of low|moderate|high",
    });
  }

  return errors;
}

/**
 * Write or update the [sampling] section in flaker.toml.
 * Preserves existing content by replacing the section if it exists,
 * or appending it at the end.
 */
export function writeSamplingConfig(dir: string, sampling: SamplingConfig): void {
  const filePath = join(dir, "flaker.toml");
  const content = readFileSync(filePath, "utf-8");

  const lines: string[] = [
    "[sampling]",
    `strategy = "${sampling.strategy}"`,
  ];
  if (sampling.sample_percentage != null) lines.push(`sample_percentage = ${sampling.sample_percentage}`);
  if (sampling.holdout_ratio != null) lines.push(`holdout_ratio = ${sampling.holdout_ratio}`);
  if (sampling.co_failure_window_days != null) lines.push(`co_failure_window_days = ${sampling.co_failure_window_days}`);
  if (sampling.skip_quarantined != null) lines.push(`skip_quarantined = ${sampling.skip_quarantined}`);
  if (sampling.calibrated_at != null) lines.push(`calibrated_at = "${sampling.calibrated_at}"`);
  if (sampling.detected_flaky_rate_ratio != null) lines.push(`detected_flaky_rate_ratio = ${sampling.detected_flaky_rate_ratio}`);
  if (sampling.detected_co_failure_strength_ratio != null) lines.push(`detected_co_failure_strength_ratio = ${sampling.detected_co_failure_strength_ratio}`);
  if (sampling.detected_test_count != null) lines.push(`detected_test_count = ${sampling.detected_test_count}`);

  const samplingBlock = lines.join("\n") + "\n";

  // Replace existing [sampling] section or append
  const sectionRegex = /^\[sampling\]\n(?:(?!\n\[)[^\n]*\n)*/m;
  let updated: string;
  if (sectionRegex.test(content)) {
    updated = content.replace(sectionRegex, samplingBlock);
  } else {
    updated = content.trimEnd() + "\n\n" + samplingBlock;
  }

  writeFileSync(filePath, updated, "utf-8");
}
