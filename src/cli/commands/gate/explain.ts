import type { FlakerConfig } from "../../config.js";
import type { GateName } from "../../gate.js";
import type { ResolvedProfile } from "../../profile-compat.js";

export interface GateExplainValue<T> {
  value: T;
  source: string;
}

export interface GateExplainReport {
  gate: GateName;
  backingProfile: string;
  resolved: {
    strategy: GateExplainValue<string>;
    samplePercentage: GateExplainValue<number | null>;
    holdoutRatio: GateExplainValue<number | null>;
    coFailureWindowDays: GateExplainValue<number | null>;
    clusterMode: GateExplainValue<string | null>;
    skipQuarantined: GateExplainValue<boolean | null>;
    skipFlakyTagged: GateExplainValue<boolean | null>;
    adaptive: GateExplainValue<boolean>;
    maxDurationSeconds: GateExplainValue<number | null>;
    fallbackStrategy: GateExplainValue<string | null>;
  };
  migrationHints: string[];
}

function sourceForProfileField<T>(
  profileName: string,
  profileValue: T | undefined,
  samplingValue: T | undefined,
  defaultValue: T | null,
): GateExplainValue<T | null> {
  if (profileValue !== undefined) {
    return { value: profileValue, source: `profile.${profileName}` };
  }
  if (samplingValue !== undefined) {
    return { value: samplingValue, source: "sampling" };
  }
  return { value: defaultValue, source: "default" };
}

export function buildGateExplain(input: {
  gate: GateName;
  config: FlakerConfig;
  profile: ResolvedProfile;
}): GateExplainReport {
  const profileConfig = input.config.profile?.[input.profile.name];
  const sampling = input.config.sampling;
  const isFull = input.profile.strategy === "full";

  const strategy: GateExplainValue<string> = profileConfig?.strategy !== undefined
    ? { value: profileConfig.strategy, source: `profile.${input.profile.name}` }
    : sampling?.strategy !== undefined
    ? { value: sampling.strategy, source: "sampling" }
    : { value: input.profile.strategy, source: "default" };
  const samplePercentage = isFull
    ? { value: input.profile.sample_percentage ?? null, source: "derived(full-strategy)" }
    : sourceForProfileField(
      input.profile.name,
      profileConfig?.sample_percentage,
      sampling?.sample_percentage,
      input.profile.sample_percentage ?? null,
    );
  const holdoutRatio = isFull
    ? { value: input.profile.holdout_ratio ?? null, source: "derived(full-strategy)" }
    : sourceForProfileField(
      input.profile.name,
      profileConfig?.holdout_ratio,
      sampling?.holdout_ratio,
      input.profile.holdout_ratio ?? null,
    );

  const resolved = {
    strategy,
    samplePercentage,
    holdoutRatio,
    coFailureWindowDays: sourceForProfileField(
      input.profile.name,
      profileConfig?.co_failure_window_days,
      sampling?.co_failure_window_days,
      input.profile.co_failure_window_days ?? null,
    ),
    clusterMode: sourceForProfileField(
      input.profile.name,
      profileConfig?.cluster_mode,
      sampling?.cluster_mode,
      input.profile.cluster_mode ?? null,
    ),
    skipQuarantined: sourceForProfileField(
      input.profile.name,
      profileConfig?.skip_quarantined,
      sampling?.skip_quarantined,
      input.profile.skip_quarantined ?? null,
    ),
    skipFlakyTagged: sourceForProfileField(
      input.profile.name,
      profileConfig?.skip_flaky_tagged,
      sampling?.skip_flaky_tagged,
      input.profile.skip_flaky_tagged ?? null,
    ),
    adaptive: {
      value: input.profile.adaptive,
      source: profileConfig?.adaptive !== undefined ? `profile.${input.profile.name}` : "default",
    },
    maxDurationSeconds: {
      value: input.profile.max_duration_seconds ?? null,
      source: profileConfig?.max_duration_seconds !== undefined ? `profile.${input.profile.name}` : "default",
    },
    fallbackStrategy: {
      value: input.profile.fallback_strategy ?? null,
      source: profileConfig?.fallback_strategy !== undefined ? `profile.${input.profile.name}` : "default",
    },
  };

  const migrationHints = new Set<string>();
  for (const item of Object.values(resolved)) {
    if (item.source === "sampling") {
      migrationHints.add("Some values still resolve from legacy [sampling].");
    }
    if (item.source.startsWith("profile.")) {
      migrationHints.add("Some values still resolve from legacy [profile.*].");
    }
  }

  return {
    gate: input.gate,
    backingProfile: input.profile.name,
    resolved,
    migrationHints: [...migrationHints],
  };
}

export function formatGateExplain(report: GateExplainReport): string {
  const lines = [
    `Gate Explain: ${report.gate}`,
    `Backing profile: ${report.backingProfile}`,
    "",
    "Resolved values:",
  ];

  const entries = [
    ["strategy", report.resolved.strategy],
    ["samplePercentage", report.resolved.samplePercentage],
    ["holdoutRatio", report.resolved.holdoutRatio],
    ["coFailureWindowDays", report.resolved.coFailureWindowDays],
    ["clusterMode", report.resolved.clusterMode],
    ["skipQuarantined", report.resolved.skipQuarantined],
    ["skipFlakyTagged", report.resolved.skipFlakyTagged],
    ["adaptive", report.resolved.adaptive],
    ["maxDurationSeconds", report.resolved.maxDurationSeconds],
    ["fallbackStrategy", report.resolved.fallbackStrategy],
  ] as const;

  for (const [name, item] of entries) {
    lines.push(`- ${name}: ${String(item.value)} (${item.source})`);
  }

  if (report.migrationHints.length > 0) {
    lines.push("", "Migration hints:");
    for (const hint of report.migrationHints) {
      lines.push(`- ${hint}`);
    }
  }

  return lines.join("\n");
}
