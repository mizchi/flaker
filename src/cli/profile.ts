import type { ProfileConfig, SamplingConfig } from "./config.ts";

export interface ResolvedProfile {
  name: string;
  strategy: string;
  percentage?: number;
  holdout_ratio?: number;
  co_failure_days?: number;
  model_path?: string;
  skip_quarantined?: boolean;
  adaptive: boolean;
  adaptive_fnr_low: number;
  adaptive_fnr_high: number;
  adaptive_min_percentage: number;
  adaptive_step: number;
  max_duration_seconds?: number;
  fallback_strategy?: string;
}

const ADAPTIVE_DEFAULTS = {
  adaptive: false,
  adaptive_fnr_low: 0.02,
  adaptive_fnr_high: 0.05,
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
    strategy: sampling?.strategy ?? "random",
    percentage: sampling?.percentage,
    holdout_ratio: sampling?.holdout_ratio,
    co_failure_days: sampling?.co_failure_days,
    model_path: sampling?.model_path,
    skip_quarantined: sampling?.skip_quarantined,
  };

  // Override with profile config
  const merged = profileConfig ? { ...base, ...profileConfig } : base;

  // Force full strategy overrides
  if (merged.strategy === "full") {
    merged.percentage = 100;
    merged.holdout_ratio = 0;
  }

  // Resolve adaptive fields with defaults
  const adaptive = profileConfig?.adaptive ?? ADAPTIVE_DEFAULTS.adaptive;
  const adaptive_fnr_low = profileConfig?.adaptive_fnr_low ?? ADAPTIVE_DEFAULTS.adaptive_fnr_low;
  const adaptive_fnr_high = profileConfig?.adaptive_fnr_high ?? ADAPTIVE_DEFAULTS.adaptive_fnr_high;
  const adaptive_min_percentage = profileConfig?.adaptive_min_percentage ?? ADAPTIVE_DEFAULTS.adaptive_min_percentage;
  const adaptive_step = profileConfig?.adaptive_step ?? ADAPTIVE_DEFAULTS.adaptive_step;

  return {
    name: profileName,
    strategy: merged.strategy,
    percentage: merged.percentage,
    holdout_ratio: merged.holdout_ratio,
    co_failure_days: merged.co_failure_days,
    model_path: merged.model_path,
    skip_quarantined: merged.skip_quarantined,
    adaptive,
    adaptive_fnr_low,
    adaptive_fnr_high,
    adaptive_min_percentage,
    adaptive_step,
    max_duration_seconds: profileConfig?.max_duration_seconds,
    fallback_strategy: profileConfig?.fallback_strategy,
  };
}
