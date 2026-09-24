import { resolve } from "node:path";
import type { FlakerConfig } from "../../config.js";
import { createResolver as createResolverDefault } from "../../resolvers/index.js";
import type { DependencyResolver } from "../../resolvers/types.js";
import { detectChangedFiles as detectChangedFilesDefault } from "../../core/git.js";
import {
  loadQuarantineManifestIfExists as loadQuarantineManifestIfExistsDefault,
  type QuarantineManifestEntry,
} from "../../quarantine-manifest.js";
import type { GateName } from "../../gate.js";
import {
  resolveGate,
  resolveGateName,
  resolveFallbackSamplingMode,
  type ResolvedGate,
} from "../../gate-config.js";
import { computeAdaptivePercentage } from "../../adaptive.js";
import { computeKpi as computeKpiDefault } from "../analyze/kpi.js";
import { runInsights as runInsightsDefault } from "../analyze/insights.js";
import type { MetricStore } from "../../storage/types.js";
import {
  parseSampleCount,
  parseSamplePercentage,
  parseSamplingMode,
  type SamplingMode,
} from "./sampling-options.js";

export interface RunCliOpts {
  gate?: string;
  strategy?: string;
  count?: string;
  percentage?: string;
  skipQuarantined?: boolean;
  skipFlakyTagged?: boolean;
  changed?: string;
  coFailureDays?: string;
  holdoutRatio?: string;
}

export interface PreparedRunRequest {
  gateName: GateName;
  resolvedGate: ResolvedGate;
  mode: SamplingMode;
  fallbackMode?: SamplingMode;
  count?: number;
  percentage?: number;
  skipQuarantined?: boolean;
  skipFlakyTagged?: boolean;
  changedFiles?: string[];
  coFailureDays?: number;
  holdoutRatio?: number;
  resolver?: DependencyResolver;
  quarantineManifestEntries?: QuarantineManifestEntry[];
  adaptiveReason?: string;
  timeBudgetSeconds?: number;
}

export interface PrepareRunRequestDeps {
  detectChangedFiles?: typeof detectChangedFilesDefault;
  loadQuarantineManifestIfExists?: typeof loadQuarantineManifestIfExistsDefault;
  createResolver?: typeof createResolverDefault;
  computeKpi?: typeof computeKpiDefault;
  runInsights?: typeof runInsightsDefault;
}

interface PrepareRunRequestOpts {
  cwd: string;
  config: FlakerConfig;
  store: MetricStore;
  opts: RunCliOpts;
  deps?: PrepareRunRequestDeps;
}

function parseChangedFiles(input?: string): string[] | undefined {
  const files = input
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return files && files.length > 0 ? files : undefined;
}

function resolveChangedFiles(
  cwd: string,
  explicit: string | undefined,
  detectChangedFiles: typeof detectChangedFilesDefault,
): string[] | undefined {
  const parsed = parseChangedFiles(explicit);
  if (parsed) return parsed;
  const detected = detectChangedFiles(cwd);
  return detected.length > 0 ? detected : undefined;
}

export async function prepareRunRequest(
  input: PrepareRunRequestOpts,
): Promise<PreparedRunRequest> {
  const deps = input.deps ?? {};
  const detectChangedFiles = deps.detectChangedFiles ?? detectChangedFilesDefault;
  const loadQuarantineManifestIfExists =
    deps.loadQuarantineManifestIfExists ?? loadQuarantineManifestIfExistsDefault;
  const createResolver = deps.createResolver ?? createResolverDefault;
  const computeKpi = deps.computeKpi ?? computeKpiDefault;
  const runInsights = deps.runInsights ?? runInsightsDefault;

  const gateName = resolveGateName(input.opts.gate);
  const resolvedGate = resolveGate(gateName, input.config.gate, input.config.sampling);
  // Adaptive sampling is read straight from [gate.<name>] until it is removed.
  const adaptiveConfig = input.config.gate?.[gateName];
  const requestedStrategy = input.opts.strategy?.trim();
  const mode = parseSamplingMode(
    requestedStrategy && requestedStrategy.length > 0
      ? requestedStrategy
      : resolvedGate.strategy,
  );
  const changedFiles = resolveChangedFiles(input.cwd, input.opts.changed, detectChangedFiles);
  const skipQuarantined = input.opts.skipQuarantined ?? resolvedGate.skip_quarantined;
  const shouldLoadQuarantineManifest = Boolean(
    skipQuarantined || input.config.quarantine.runtime_apply,
  );
  const quarantineManifestEntries = shouldLoadQuarantineManifest
    ? loadQuarantineManifestIfExists({
      cwd: input.cwd,
      manifestPath: input.config.quarantine.manifest,
    })?.entries
    : undefined;
  const resolver =
    (mode === "affected" || mode === "hybrid") && changedFiles?.length
      ? createResolver(
        {
          resolver: input.config.affected.resolver ?? "simple",
          config: input.config.affected.config
            ? resolve(input.cwd, input.config.affected.config)
            : undefined,
        },
        input.cwd,
      )
      : undefined;

  let percentage =
    parseSamplePercentage(input.opts.percentage) ?? resolvedGate.sample_percentage;
  let adaptiveReason: string | undefined;
  if (adaptiveConfig?.adaptive && percentage != null) {
    const kpiData = await computeKpi(input.store);
    const insightsData = await runInsights({ store: input.store });
    const divergenceRate = insightsData.summary.totalTests > 0
      ? insightsData.summary.ciOnlyCount / insightsData.summary.totalTests
      : null;
    const adaptive = computeAdaptivePercentage(
      {
        falseNegativeRate: kpiData.sampling.falseNegativeRate,
        divergenceRate,
      },
      {
        basePercentage: percentage,
        fnrLow: adaptiveConfig.adaptive_fnr_low_ratio ?? 0.02,
        fnrHigh: adaptiveConfig.adaptive_fnr_high_ratio ?? 0.05,
        minPercentage: adaptiveConfig.adaptive_min_percentage ?? 10,
        step: adaptiveConfig.adaptive_step ?? 5,
      },
    );
    percentage = adaptive.percentage;
    adaptiveReason = adaptive.reason;
  }

  return {
    gateName,
    resolvedGate,
    mode,
    fallbackMode: resolveFallbackSamplingMode(resolvedGate),
    count: parseSampleCount(input.opts.count),
    percentage,
    skipQuarantined,
    skipFlakyTagged: input.opts.skipFlakyTagged ?? resolvedGate.skip_flaky_tagged,
    changedFiles,
    coFailureDays: input.opts.coFailureDays
      ? parseInt(input.opts.coFailureDays, 10)
      : resolvedGate.co_failure_window_days,
    holdoutRatio: input.opts.holdoutRatio
      ? parseFloat(input.opts.holdoutRatio)
      : resolvedGate.holdout_ratio,
    resolver,
    quarantineManifestEntries,
    adaptiveReason,
    timeBudgetSeconds: resolvedGate.max_duration_seconds,
  };
}
