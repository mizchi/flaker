import type { GateConfig, SamplingConfig } from "./config.js";
import { parseSamplingMode, type SamplingMode } from "./commands/exec/sampling-options.js";
import { LEGACY_PROFILE_TO_GATE, normalizeGateName, type GateName } from "./gate.js";

export interface ResolvedGate {
  name: GateName;
  strategy: string;
  sample_percentage?: number;
  holdout_ratio?: number;
  co_failure_window_days?: number;
  skip_quarantined?: boolean;
  skip_flaky_tagged?: boolean;
  max_duration_seconds?: number;
  fallback_strategy?: string;
}

type Env = Record<string, string | undefined>;

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveFallbackSamplingMode(
  gate: Pick<ResolvedGate, "fallback_strategy">,
): SamplingMode | undefined {
  return gate.fallback_strategy
    ? parseSamplingMode(gate.fallback_strategy)
    : undefined;
}

export function resolveGateName(explicit: string | undefined, env: Env = process.env): GateName {
  const legacyProfile = nonBlank(env["FLAKER_PROFILE"]);
  if (legacyProfile) {
    const mapped = LEGACY_PROFILE_TO_GATE[legacyProfile];
    throw new Error(
      `FLAKER_PROFILE was replaced by FLAKER_GATE in 0.13.0` +
        (mapped ? ` (${legacyProfile} → ${mapped})` : "") +
        `. See docs/migration-0.12-to-0.13.md.`,
    );
  }
  const raw =
    explicit ??
    nonBlank(env["FLAKER_GATE"]) ??
    (env["CI"] === "true" || env["GITHUB_ACTIONS"] === "true" ? "merge" : "iteration");
  const gate = normalizeGateName(raw);
  if (!gate) {
    throw new Error(`Unknown gate '${raw}'. Expected one of: iteration, merge, release.`);
  }
  return gate;
}

export function resolveGate(
  name: GateName,
  gates: Partial<Record<GateName, GateConfig>> | undefined,
  sampling: SamplingConfig | undefined,
): ResolvedGate {
  const gateConfig = gates?.[name];
  const base = {
    strategy: sampling?.strategy ?? "weighted",
    sample_percentage: sampling?.sample_percentage,
    holdout_ratio: sampling?.holdout_ratio,
    co_failure_window_days: sampling?.co_failure_window_days,
    skip_quarantined: sampling?.skip_quarantined,
    skip_flaky_tagged: sampling?.skip_flaky_tagged,
  };
  const merged = gateConfig ? { ...base, ...gateConfig } : base;
  if (merged.strategy === "full") {
    merged.sample_percentage = 100;
    merged.holdout_ratio = 0;
  }
  // Built field by field so future GateConfig-only keys do not leak into ResolvedGate.
  return {
    name,
    strategy: merged.strategy,
    sample_percentage: merged.sample_percentage,
    holdout_ratio: merged.holdout_ratio,
    co_failure_window_days: merged.co_failure_window_days,
    skip_quarantined: merged.skip_quarantined,
    skip_flaky_tagged: merged.skip_flaky_tagged,
    max_duration_seconds: gateConfig?.max_duration_seconds,
    fallback_strategy: gateConfig?.fallback_strategy,
  };
}
