import type { ProfileConfig, SamplingConfig } from "./config.js";
import { parseSamplingMode, type SamplingMode } from "./commands/exec/sampling-options.js";

export interface TimeBudgetResult<T> {
  selected: T[];
  skippedCount: number;
  skippedDurationMs: number;
}

interface TimeBudgetTest {
  avg_duration_ms: number;
  flaky_rate: number;
  co_failure_boost: number;
}

function testPriority(t: TimeBudgetTest): number {
  return t.flaky_rate + t.co_failure_boost;
}

/**
 * Filter tests to fit within a time budget.
 * Prioritizes tests with highest signal (flaky rate + co-failure boost).
 */
export function applyTimeBudget<T extends TimeBudgetTest>(
  tests: T[],
  maxDurationSeconds: number,
): TimeBudgetResult<T> {
  const budgetMs = maxDurationSeconds * 1000;
  const totalMs = tests.reduce((sum, t) => sum + t.avg_duration_ms, 0);

  if (totalMs <= budgetMs) {
    return { selected: tests, skippedCount: 0, skippedDurationMs: 0 };
  }

  // Sort by priority descending
  const sorted = [...tests].sort((a, b) => testPriority(b) - testPriority(a));
  const selected: T[] = [];
  let accMs = 0;

  for (const t of sorted) {
    if (accMs + t.avg_duration_ms > budgetMs && selected.length > 0) {
      continue;
    }
    selected.push(t);
    accMs += t.avg_duration_ms;
  }

  const skippedCount = tests.length - selected.length;
  const skippedDurationMs = totalMs - accMs;

  return { selected, skippedCount, skippedDurationMs };
}

export interface AdaptivePercentageOpts {
  basePercentage: number;
  fnrLow: number;
  fnrHigh: number;
  minPercentage: number;
  step: number;
}

export interface AdaptivePercentageResult {
  percentage: number;
  reason: string;
}

export interface AdaptiveSignals {
  falseNegativeRate: number | null;
  divergenceRate: number | null;
}

function formatSignals(signals: AdaptiveSignals): string {
  const parts: string[] = [];
  if (signals.falseNegativeRate != null) {
    parts.push(`FNR ${(signals.falseNegativeRate * 100).toFixed(1)}%`);
  }
  if (signals.divergenceRate != null) {
    parts.push(`divergence ${(signals.divergenceRate * 100).toFixed(1)}%`);
  }
  return parts.join(", ");
}

export function computeAdaptivePercentage(
  signals: AdaptiveSignals,
  opts: AdaptivePercentageOpts,
): AdaptivePercentageResult {
  const { falseNegativeRate: fnr, divergenceRate: div } = signals;

  if (fnr == null && div == null) {
    return {
      percentage: opts.basePercentage,
      reason: "adaptive: no data, using base percentage",
    };
  }

  const effectiveRate = Math.max(fnr ?? 0, div ?? 0);
  const driverSignal = (div ?? 0) >= (fnr ?? 0) ? "divergence" : "FNR";
  const signalsStr = formatSignals(signals);

  if (effectiveRate < opts.fnrLow) {
    const reduced = Math.max(opts.minPercentage, opts.basePercentage - opts.step);
    return {
      percentage: reduced,
      reason: `adaptive: ${signalsStr} (${driverSignal} drove) < ${(opts.fnrLow * 100).toFixed(0)}% threshold, reduced to ${reduced}%`,
    };
  }

  if (effectiveRate > opts.fnrHigh) {
    const increased = opts.basePercentage + opts.step;
    return {
      percentage: increased,
      reason: `adaptive: ${signalsStr} (${driverSignal} drove) > ${(opts.fnrHigh * 100).toFixed(0)}% threshold, increased to ${increased}%`,
    };
  }

  return {
    percentage: opts.basePercentage,
    reason: `adaptive: ${signalsStr} (${driverSignal} drove) within target range, keeping ${opts.basePercentage}%`,
  };
}

export interface ResolvedProfile {
  name: string;
  strategy: string;
  sample_percentage?: number;
  holdout_ratio?: number;
  co_failure_window_days?: number;
  model_path?: string;
  skip_quarantined?: boolean;
  adaptive: boolean;
  adaptive_fnr_low_ratio: number;
  adaptive_fnr_high_ratio: number;
  adaptive_min_percentage: number;
  adaptive_step: number;
  max_duration_seconds?: number;
  fallback_strategy?: string;
}

export function resolveFallbackSamplingMode(
  profile: Pick<ResolvedProfile, "fallback_strategy">,
): SamplingMode | undefined {
  return profile.fallback_strategy
    ? parseSamplingMode(profile.fallback_strategy)
    : undefined;
}

const ADAPTIVE_DEFAULTS = {
  adaptive: false,
  adaptive_fnr_low_ratio: 0.02,
  adaptive_fnr_high_ratio: 0.05,
  adaptive_min_percentage: 10,
  adaptive_step: 5,
} as const;

/**
 * Detect the active profile name.
 * Priority: explicit arg > FLAKER_PROFILE env > CI detection > "local"
 */
export function detectProfileName(explicit: string | undefined): string {
  if (explicit !== undefined) return explicit;
  const envProfile = process.env["FLAKER_PROFILE"];
  if (envProfile) return envProfile;
  if (process.env["CI"] === "true" || process.env["GITHUB_ACTIONS"] === "true") return "ci";
  return "local";
}

/**
 * Resolve a profile by merging profile config over sampling defaults.
 */
export function resolveProfile(
  profileName: string,
  profiles: Record<string, ProfileConfig> | undefined,
  sampling: SamplingConfig | undefined,
): ResolvedProfile {
  const profileConfig: ProfileConfig | undefined = profiles?.[profileName];

  // Base from sampling config
  const base = {
    strategy: sampling?.strategy ?? "weighted",
    sample_percentage: sampling?.sample_percentage,
    holdout_ratio: sampling?.holdout_ratio,
    co_failure_window_days: sampling?.co_failure_window_days,
    model_path: sampling?.model_path,
    skip_quarantined: sampling?.skip_quarantined,
  };

  // Override with profile config
  const merged = profileConfig ? { ...base, ...profileConfig } : base;

  // Force full strategy overrides
  if (merged.strategy === "full") {
    merged.sample_percentage = 100;
    merged.holdout_ratio = 0;
  }

  // Resolve adaptive fields with defaults
  const adaptive = profileConfig?.adaptive ?? ADAPTIVE_DEFAULTS.adaptive;
  const adaptive_fnr_low_ratio = profileConfig?.adaptive_fnr_low_ratio ?? ADAPTIVE_DEFAULTS.adaptive_fnr_low_ratio;
  const adaptive_fnr_high_ratio = profileConfig?.adaptive_fnr_high_ratio ?? ADAPTIVE_DEFAULTS.adaptive_fnr_high_ratio;
  const adaptive_min_percentage = profileConfig?.adaptive_min_percentage ?? ADAPTIVE_DEFAULTS.adaptive_min_percentage;
  const adaptive_step = profileConfig?.adaptive_step ?? ADAPTIVE_DEFAULTS.adaptive_step;

  return {
    name: profileName,
    strategy: merged.strategy,
    sample_percentage: merged.sample_percentage,
    holdout_ratio: merged.holdout_ratio,
    co_failure_window_days: merged.co_failure_window_days,
    model_path: merged.model_path,
    skip_quarantined: merged.skip_quarantined,
    adaptive,
    adaptive_fnr_low_ratio,
    adaptive_fnr_high_ratio,
    adaptive_min_percentage,
    adaptive_step,
    max_duration_seconds: profileConfig?.max_duration_seconds,
    fallback_strategy: profileConfig?.fallback_strategy,
  };
}
