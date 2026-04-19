import type { FlakerConfig } from "../../config.js";
import { resolveProfile } from "../../profile-compat.js";
import type { MetricStore } from "../../storage/types.js";
import { computeKpi } from "../analyze/kpi.js";
import { buildGateReview, type GateReviewReport } from "../gate/review.js";
import { runQuarantineSuggest, type QuarantineSuggestionPlan } from "../quarantine/suggest.js";
import { runStatusSummary } from "../status/summary.js";

export interface OpsDailyReleaseRun {
  gate: "release";
  exitCode: number;
  outcome: "passed" | "failed";
  sampledCount: number;
  holdoutCount: number;
  holdoutFailureCount: number;
}

export interface OpsDailyReport {
  schemaVersion: 1;
  generatedAt: string;
  scope: {
    branch: string;
    days: number;
  };
  collection: {
    totalRuns: number;
    ciRuns: number;
    localRuns: number;
    totalResults: number;
    passedResults: number;
    failedResults: number;
  };
  releaseRun: OpsDailyReleaseRun;
  releaseGate: GateReviewReport;
  quarantineSuggestions: QuarantineSuggestionPlan;
  pendingArtifacts: {
    quarantineAddCount: number;
    quarantineRemoveCount: number;
    holdoutFailureCount: number;
  };
  actionItems: string[];
}

function buildActionItems(input: {
  releaseRun: OpsDailyReleaseRun;
  releaseGate: GateReviewReport;
  quarantinePlan: QuarantineSuggestionPlan;
}): string[] {
  const items: string[] = [];

  if (input.releaseRun.outcome === "failed") {
    items.push("Investigate the failed release gate run before trusting the daily signal.");
  }
  if (input.releaseRun.holdoutFailureCount > 0) {
    items.push(
      `Investigate ${input.releaseRun.holdoutFailureCount} holdout misses detected during the release run.`,
    );
  }

  if (input.releaseGate.recommendedAction === "demote") {
    items.push("Demote or loosen the release gate until sampling quality recovers.");
  } else if (input.releaseGate.recommendedAction === "investigate") {
    items.push("Investigate release gate signal quality before changing policy.");
  } else if (items.length === 0) {
    items.push("Archive the daily release snapshot and keep the observation loop running.");
  }

  if (input.quarantinePlan.add.length > 0 || input.quarantinePlan.remove.length > 0) {
    items.push(
      `Review quarantine plan: +${input.quarantinePlan.add.length} / -${input.quarantinePlan.remove.length}.`,
    );
  }

  return items;
}

export async function runOpsDaily(input: {
  store: MetricStore;
  config: FlakerConfig;
  now?: Date;
  windowDays?: number;
  executeReleaseGate: () => Promise<{
    exitCode: number;
    sampledCount: number;
    holdoutCount: number;
    holdoutFailureCount: number;
  }>;
}): Promise<OpsDailyReport> {
  const now = input.now ?? new Date();
  const windowDays = input.windowDays ?? 1;
  const releaseExecution = await input.executeReleaseGate();
  const [status, kpi, quarantinePlan] = await Promise.all([
    runStatusSummary({
      store: input.store,
      config: input.config,
      now,
      windowDays,
    }),
    computeKpi(input.store, { windowDays }),
    runQuarantineSuggest({
      store: input.store,
      now,
      windowDays,
      flakyRateThresholdPercentage: input.config.quarantine.flaky_rate_threshold_percentage,
      minRuns: input.config.quarantine.min_runs,
    }),
  ]);
  const releaseProfile = resolveProfile("scheduled", input.config.profile, input.config.sampling);
  const releaseGate = buildGateReview({
    gate: "release",
    profile: releaseProfile,
    kpi,
  });
  const releaseRun: OpsDailyReleaseRun = {
    gate: "release",
    exitCode: releaseExecution.exitCode,
    outcome: releaseExecution.exitCode === 0 ? "passed" : "failed",
    sampledCount: releaseExecution.sampledCount,
    holdoutCount: releaseExecution.holdoutCount,
    holdoutFailureCount: releaseExecution.holdoutFailureCount,
  };

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    scope: {
      branch: "main",
      days: windowDays,
    },
    collection: {
      ...status.activity,
      totalResults: status.activity.passedResults + status.activity.failedResults,
    },
    releaseRun,
    releaseGate,
    quarantineSuggestions: quarantinePlan,
    pendingArtifacts: {
      quarantineAddCount: quarantinePlan.add.length,
      quarantineRemoveCount: quarantinePlan.remove.length,
      holdoutFailureCount: releaseExecution.holdoutFailureCount,
    },
    actionItems: buildActionItems({
      releaseRun,
      releaseGate,
      quarantinePlan,
    }),
  };
}

export function formatOpsDailyReport(report: OpsDailyReport): string {
  const lines = [
    "# Ops Daily",
    "",
    `Scope: ${report.scope.branch}, last ${report.scope.days}d`,
    "",
    "## Collection",
    `  total runs:         ${report.collection.totalRuns}`,
    `  ci runs:            ${report.collection.ciRuns}`,
    `  local runs:         ${report.collection.localRuns}`,
    `  total results:      ${report.collection.totalResults}`,
    `  passed results:     ${report.collection.passedResults}`,
    `  failed results:     ${report.collection.failedResults}`,
    "",
    "## Release run",
    `  outcome:            ${report.releaseRun.outcome}`,
    `  sampled tests:      ${report.releaseRun.sampledCount}`,
    `  holdout tests:      ${report.releaseRun.holdoutCount}`,
    `  holdout failures:   ${report.releaseRun.holdoutFailureCount}`,
    "",
    "## Release gate",
    `  readiness:          ${report.releaseGate.promotionReadiness.status}`,
    `  action:             ${report.releaseGate.recommendedAction}`,
    "",
    "## Pending artifacts",
    `  quarantine plan:    +${report.pendingArtifacts.quarantineAddCount} / -${report.pendingArtifacts.quarantineRemoveCount}`,
    `  holdout failures:   ${report.pendingArtifacts.holdoutFailureCount}`,
    "",
    "## Action items",
  ];

  for (const item of report.actionItems) {
    lines.push(`- ${item}`);
  }

  return lines.join("\n");
}
