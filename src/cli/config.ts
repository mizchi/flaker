import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";

export interface CoverageConfig {
  format: string; // istanbul | v8 | playwright
  input: string; // path to coverage JSON or directory
  granularity?: string; // statement (default) | function | branch
}

export interface SamplingConfig {
  strategy: string;
  sample_percentage?: number;           // was `percentage`
  holdout_ratio?: number;
  co_failure_window_days?: number;      // was `co_failure_days`
  cluster_mode?: "off" | "spread" | "pack";
  model_path?: string;
  skip_quarantined?: boolean;
  skip_flaky_tagged?: boolean;
  calibrated_at?: string;
  detected_flaky_rate_ratio?: number;   // was `detected_flaky_rate`
  detected_co_failure_strength_ratio?: number;  // was `detected_co_failure_strength`
  detected_test_count?: number;
}

export interface ProfileConfig {
  strategy: string;
  sample_percentage?: number;           // was `percentage`
  holdout_ratio?: number;
  co_failure_window_days?: number;      // was `co_failure_days`
  cluster_mode?: "off" | "spread" | "pack";
  model_path?: string;
  skip_quarantined?: boolean;
  skip_flaky_tagged?: boolean;
  adaptive?: boolean;
  adaptive_fnr_low_ratio?: number;      // was `adaptive_fnr_low`
  adaptive_fnr_high_ratio?: number;     // was `adaptive_fnr_high`
  adaptive_min_percentage?: number;
  adaptive_step?: number;
  max_duration_seconds?: number;
  fallback_strategy?: string;
}

export interface FlakerConfig {
  repo: { owner: string; name: string };
  storage: { path: string };
  collect?: { workflow_paths?: string[] };
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
  quarantine: { auto: boolean; flaky_rate_threshold_percentage: number; min_runs: number };
  flaky: { window_days: number; detection_threshold_ratio: number };
  coverage?: CoverageConfig;
  sampling?: SamplingConfig;
  profile?: Record<string, ProfileConfig>;
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

const LEGACY_PROFILE_KEYS: LegacyKeyEntry[] = [
  { section: "profile.*", oldKey: "percentage", newKey: "sample_percentage", unitNote: "value range 0-100" },
  { section: "profile.*", oldKey: "co_failure_days", newKey: "co_failure_window_days", unitNote: "days (int)" },
  { section: "profile.*", oldKey: "adaptive_fnr_low", newKey: "adaptive_fnr_low_ratio", unitNote: "0.0-1.0" },
  { section: "profile.*", oldKey: "adaptive_fnr_high", newKey: "adaptive_fnr_high_ratio", unitNote: "0.0-1.0" },
];

function checkLegacyKeys(parsed: Record<string, unknown>): void {
  const errors: string[] = [];

  for (const entry of LEGACY_KEYS) {
    const section = parsed[entry.section];
    if (section && typeof section === "object" && entry.oldKey in (section as Record<string, unknown>)) {
      errors.push(
        `deprecated key \`${entry.oldKey}\` in [${entry.section}] → rename to \`${entry.newKey}\` (${entry.unitNote})`
      );
    }
  }

  const profiles = parsed.profile as Record<string, unknown> | undefined;
  if (profiles && typeof profiles === "object") {
    for (const [profileName, profileValue] of Object.entries(profiles)) {
      if (!profileValue || typeof profileValue !== "object") continue;
      for (const entry of LEGACY_PROFILE_KEYS) {
        if (entry.oldKey in (profileValue as Record<string, unknown>)) {
          errors.push(
            `deprecated key \`${entry.oldKey}\` in [profile.${profileName}] → rename to \`${entry.newKey}\` (${entry.unitNote})`
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `flaker.toml uses deprecated keys (see docs/how-to-use.md#config-migration):\n` +
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
  value: number;
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

  if (config.profile) {
    for (const [name, p] of Object.entries(config.profile)) {
      check(`profile.${name}.sample_percentage`, p.sample_percentage, 0, 100, "0-100");
      check(`profile.${name}.holdout_ratio`, p.holdout_ratio, 0, 1, "0.0-1.0");
      check(`profile.${name}.adaptive_fnr_low_ratio`, p.adaptive_fnr_low_ratio, 0, 1, "0.0-1.0");
      check(`profile.${name}.adaptive_fnr_high_ratio`, p.adaptive_fnr_high_ratio, 0, 1, "0.0-1.0");
      check(`profile.${name}.adaptive_min_percentage`, p.adaptive_min_percentage, 0, 100, "0-100");
    }
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
  if (sampling.cluster_mode != null) lines.push(`cluster_mode = "${sampling.cluster_mode}"`);
  if (sampling.model_path != null) lines.push(`model_path = "${sampling.model_path}"`);
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
