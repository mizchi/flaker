import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";

export interface SamplingConfig {
  strategy: string;
  percentage?: number;
  holdout_ratio?: number;
  co_failure_days?: number;
  model_path?: string;
  skip_quarantined?: boolean;
  calibrated_at?: string;
  detected_flaky_rate?: number;
  detected_co_failure_strength?: number;
  detected_test_count?: number;
}

export interface ProfileConfig {
  strategy: string;
  percentage?: number;
  holdout_ratio?: number;
  co_failure_days?: number;
  model_path?: string;
  skip_quarantined?: boolean;
  adaptive?: boolean;
  adaptive_fnr_low?: number;
  adaptive_fnr_high?: number;
  adaptive_min_percentage?: number;
  adaptive_step?: number;
  max_duration_seconds?: number;
  fallback_strategy?: string;
}

export interface FlakerConfig {
  repo: { owner: string; name: string };
  storage: { path: string };
  adapter: { type: string; command?: string; artifact_name?: string };
  runner: {
    type: string;
    command: string;
    execute?: string;
    list?: string;
    actrun?: { workflow: string };
  };
  affected: { resolver: string; config: string };
  quarantine: { auto: boolean; flaky_rate_threshold: number; min_runs: number };
  flaky: { window_days: number; detection_threshold: number };
  sampling?: SamplingConfig;
  profile?: Record<string, ProfileConfig>;
}

const DEFAULT_CONFIG: FlakerConfig = {
  repo: { owner: "", name: "" },
  storage: { path: ".flaker/data" },
  adapter: { type: "playwright" },
  runner: { type: "vitest", command: "pnpm test" },
  affected: { resolver: "git", config: "" },
  quarantine: { auto: true, flaky_rate_threshold: 0.3, min_runs: 5 },
  flaky: { window_days: 14, detection_threshold: 0.1 },
};

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

export function loadConfig(dir: string): FlakerConfig {
  const filePath = join(dir, "flaker.toml");
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(`Config file not found: ${filePath}. Run 'flaker init' to create one.`);
  }
  const parsed = parse(content) as unknown as Record<string, unknown>;
  return deepMerge(DEFAULT_CONFIG, parsed);
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
  if (sampling.percentage != null) lines.push(`percentage = ${sampling.percentage}`);
  if (sampling.holdout_ratio != null) lines.push(`holdout_ratio = ${sampling.holdout_ratio}`);
  if (sampling.co_failure_days != null) lines.push(`co_failure_days = ${sampling.co_failure_days}`);
  if (sampling.model_path != null) lines.push(`model_path = "${sampling.model_path}"`);
  if (sampling.skip_quarantined != null) lines.push(`skip_quarantined = ${sampling.skip_quarantined}`);
  if (sampling.calibrated_at != null) lines.push(`calibrated_at = "${sampling.calibrated_at}"`);
  if (sampling.detected_flaky_rate != null) lines.push(`detected_flaky_rate = ${sampling.detected_flaky_rate}`);
  if (sampling.detected_co_failure_strength != null) lines.push(`detected_co_failure_strength = ${sampling.detected_co_failure_strength}`);
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
