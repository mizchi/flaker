import type { FlakerConfig, PromotionThresholds } from "../../config.js";
import { type GateName, profileNameFromGateName } from "../../gate.js";
import { resolveProfile } from "../../profile-compat.js";
import { workflowRunSourceSql } from "../../run-source.js";
import type { MetricStore } from "../../storage/types.js";
import { computeKpi, type FlakerKpi } from "../analyze/kpi.js";
import { runQuarantineSuggest } from "../quarantine/suggest.js";

export interface DriftInput {
  matchedCommits: number;
  falseNegativeRatePercentage: number | null;
  passCorrelationPercentage: number | null;
  holdoutFnrPercentage: number | null;
  dataConfidence: "insufficient" | "low" | "moderate" | "high";
}

export interface DriftItem {
  field: string;
  actual: number | string | null;
  threshold: number | string;
}

export interface DriftReport {
  ok: boolean;
  unmet: DriftItem[];
}

const CONFIDENCE_RANK = { insufficient: 0, low: 1, moderate: 2, high: 3 } as const;

export function computeDrift(input: DriftInput, thresholds: PromotionThresholds): DriftReport {
  const unmet: DriftItem[] = [];
  if (input.matchedCommits < thresholds.matched_commits_min) {
    unmet.push({
      field: "matched_commits",
      actual: input.matchedCommits,
      threshold: thresholds.matched_commits_min,
    });
  }
  if (input.falseNegativeRatePercentage == null || input.falseNegativeRatePercentage > thresholds.false_negative_rate_max_percentage) {
    unmet.push({
      field: "false_negative_rate",
      actual: input.falseNegativeRatePercentage,
      threshold: thresholds.false_negative_rate_max_percentage,
    });
  }
  if (input.passCorrelationPercentage == null || input.passCorrelationPercentage < thresholds.pass_correlation_min_percentage) {
    unmet.push({
      field: "pass_correlation",
      actual: input.passCorrelationPercentage,
      threshold: thresholds.pass_correlation_min_percentage,
    });
  }
  if (input.holdoutFnrPercentage == null || input.holdoutFnrPercentage > thresholds.holdout_fnr_max_percentage) {
    unmet.push({
      field: "holdout_fnr",
      actual: input.holdoutFnrPercentage,
      threshold: thresholds.holdout_fnr_max_percentage,
    });
  }
  if (CONFIDENCE_RANK[input.dataConfidence] < CONFIDENCE_RANK[thresholds.data_confidence_min]) {
    unmet.push({
      field: "data_confidence",
      actual: input.dataConfidence,
      threshold: thresholds.data_confidence_min,
    });
  }
  return { ok: unmet.length === 0, unmet };
}

export interface StatusGateSummary {
  profile: string;
  strategy: string;
  samplePercentage: number | null;
  maxDurationSeconds: number | null;
  adaptive: boolean;
}

export interface StatusSummary {
  generatedAt: string;
  windowDays: number;
  activity: {
    totalRuns: number;
    ciRuns: number;
    localRuns: number;
    passedResults: number;
    failedResults: number;
  };
  health: {
    dataConfidence: FlakerKpi["data"]["confidence"];
    matchedCommits: number;
    sampleRatio: number | null;
    brokenTests: number;
    intermittentFlaky: number;
    flakyTrend: number;
  };
  gates: Record<GateName, StatusGateSummary>;
  quarantine: {
    currentCount: number;
    pendingAddCount: number;
    pendingRemoveCount: number;
  };
  drift: DriftReport;
}

function buildGateSummary(config: FlakerConfig, gate: GateName): StatusGateSummary {
  const profile = resolveProfile(profileNameFromGateName(gate), config.profile, config.sampling);
  return {
    profile: profile.name,
    strategy: profile.strategy,
    samplePercentage: profile.sample_percentage ?? null,
    maxDurationSeconds: profile.max_duration_seconds ?? null,
    adaptive: profile.adaptive,
  };
}

export async function runStatusSummary(input: {
  store: MetricStore;
  config: FlakerConfig;
  now?: Date;
  windowDays?: number;
}): Promise<StatusSummary> {
  const now = input.now ?? new Date();
  const windowDays = input.windowDays ?? 30;
  const workflowSourceExpr = workflowRunSourceSql("wr");

  const [kpi, activityRows, currentQuarantine, quarantinePlan] = await Promise.all([
    computeKpi(input.store, { windowDays }),
    input.store.raw<{
      total_runs: number;
      ci_runs: number;
      local_runs: number;
      passed_results: number;
      failed_results: number;
    }>(`
      WITH recent_runs AS (
        SELECT wr.id, ${workflowSourceExpr} AS source
        FROM workflow_runs wr
        WHERE wr.created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(windowDays)} || ' days')
      ),
      recent_results AS (
        SELECT tr.status, tr.retry_count
        FROM test_results tr
        JOIN workflow_runs wr ON tr.workflow_run_id = wr.id
        WHERE tr.created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(windowDays)} || ' days')
      )
      SELECT
        (SELECT COUNT(*)::INTEGER FROM recent_runs) AS total_runs,
        (SELECT COUNT(*)::INTEGER FROM recent_runs WHERE source = 'ci') AS ci_runs,
        (SELECT COUNT(*)::INTEGER FROM recent_runs WHERE source = 'local') AS local_runs,
        (SELECT COUNT(*)::INTEGER FROM recent_results WHERE status = 'passed' AND retry_count = 0) AS passed_results,
        (SELECT COUNT(*)::INTEGER FROM recent_results WHERE status IN ('failed', 'flaky') OR (status = 'passed' AND retry_count > 0)) AS failed_results
    `),
    input.store.queryQuarantined(),
    runQuarantineSuggest({
      store: input.store,
      now,
      windowDays,
      flakyRateThresholdPercentage: input.config.quarantine.flaky_rate_threshold_percentage,
      minRuns: input.config.quarantine.min_runs,
    }),
  ]);

  const activity = activityRows[0] ?? {
    total_runs: 0,
    ci_runs: 0,
    local_runs: 0,
    passed_results: 0,
    failed_results: 0,
  };

  // kpi.sampling.falseNegativeRate, passCorrelation, and holdoutFNR are already
  // percentages (0–100); no multiplication needed.
  const drift = computeDrift(
    {
      matchedCommits: kpi.sampling.matchedCommits,
      falseNegativeRatePercentage: kpi.sampling.falseNegativeRate,
      passCorrelationPercentage: kpi.sampling.passCorrelation,
      holdoutFnrPercentage: kpi.sampling.holdoutFNR,
      dataConfidence: kpi.data.confidence,
    },
    input.config.promotion,
  );

  return {
    generatedAt: now.toISOString(),
    windowDays,
    activity: {
      totalRuns: activity.total_runs,
      ciRuns: activity.ci_runs,
      localRuns: activity.local_runs,
      passedResults: activity.passed_results,
      failedResults: activity.failed_results,
    },
    health: {
      dataConfidence: kpi.data.confidence,
      matchedCommits: kpi.sampling.matchedCommits,
      sampleRatio: kpi.sampling.sampleRatio,
      brokenTests: kpi.flaky.brokenTests,
      intermittentFlaky: kpi.flaky.intermittentFlaky,
      flakyTrend: kpi.flaky.flakyTrend,
    },
    gates: {
      iteration: buildGateSummary(input.config, "iteration"),
      merge: buildGateSummary(input.config, "merge"),
      release: buildGateSummary(input.config, "release"),
    },
    quarantine: {
      currentCount: currentQuarantine.length,
      pendingAddCount: quarantinePlan.add.length,
      pendingRemoveCount: quarantinePlan.remove.length,
    },
    drift,
  };
}

export function formatStatusSummary(summary: StatusSummary): string {
  const lines = [
    "# flaker Status",
    "",
    "## Activity",
    `  total runs:         ${summary.activity.totalRuns}`,
    `  ci runs:            ${summary.activity.ciRuns}`,
    `  local runs:         ${summary.activity.localRuns}`,
    `  passed results:     ${summary.activity.passedResults}`,
    `  failed results:     ${summary.activity.failedResults}`,
    "",
    "## Health",
    `  data confidence:    ${summary.health.dataConfidence}`,
    `  matched commits:    ${summary.health.matchedCommits}`,
    `  sample ratio:       ${summary.health.sampleRatio != null ? `${summary.health.sampleRatio}%` : "N/A"}`,
    `  broken tests:       ${summary.health.brokenTests}`,
    `  intermittent flaky: ${summary.health.intermittentFlaky}`,
    `  flaky trend:        ${summary.health.flakyTrend > 0 ? `+${summary.health.flakyTrend}` : summary.health.flakyTrend}`,
    "",
    "## Gates",
  ];

  for (const gate of ["iteration", "merge", "release"] as const) {
    const info = summary.gates[gate];
    lines.push(
      `  ${gate}: ${info.strategy} via ${info.profile}`
      + `, budget=${info.maxDurationSeconds ?? "N/A"}s`
      + `, sample=${info.samplePercentage ?? "N/A"}%`
      + `, adaptive=${info.adaptive ? "on" : "off"}`,
    );
  }

  lines.push(
    "",
    "## Quarantine",
    `  current quarantined: ${summary.quarantine.currentCount}`,
    `  pending quarantine:  +${summary.quarantine.pendingAddCount} / -${summary.quarantine.pendingRemoveCount}`,
  );

  lines.push("", "## Promotion drift");
  if (summary.drift.ok) {
    lines.push("  status: ready (all 5 thresholds met)");
  } else {
    lines.push(`  status: not ready  (${summary.drift.unmet.length}/5 thresholds unmet)`);
    for (const item of summary.drift.unmet) {
      const actual = item.actual == null ? "N/A" : typeof item.actual === "string" ? item.actual : `${item.actual}%`;
      const threshold = typeof item.threshold === "string" ? item.threshold : `${item.threshold}%`;
      let comparison: string;
      if (item.field === "matched_commits") {
        const actualNum = item.actual == null ? "N/A" : item.actual;
        const thresholdNum = item.threshold;
        lines.push(`  - ${item.field.padEnd(22)} actual=${actualNum}  threshold>=${thresholdNum}`);
      } else if (item.field === "false_negative_rate" || item.field === "holdout_fnr") {
        lines.push(`  - ${item.field.padEnd(22)} actual=${actual}  threshold<=${threshold}`);
      } else if (item.field === "pass_correlation") {
        lines.push(`  - ${item.field.padEnd(22)} actual=${actual}  threshold>=${threshold}`);
      } else if (item.field === "data_confidence") {
        lines.push(`  - ${item.field.padEnd(22)} actual=${item.actual ?? "N/A"}  threshold>=${item.threshold}`);
      } else {
        lines.push(`  - ${item.field}: actual=${actual}  threshold=${threshold}`);
      }
    }
  }

  return lines.join("\n");
}
