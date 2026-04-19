import type { FlakerConfig } from "../../config.js";
import { resolveProfile } from "../../profile-compat.js";
import type { RunnerAdapter } from "../../runners/types.js";
import type { MetricStore } from "../../storage/types.js";
import { runFlakyTagTriage, type FlakyTagTriageReport } from "../analyze/flaky-tag-triage.js";
import { buildGateReview, type GateReviewReport } from "../gate/review.js";
import { runQuarantineSuggest, type QuarantineSuggestionPlan } from "../quarantine/suggest.js";
import { computeKpi } from "../analyze/kpi.js";

export interface OpsWeeklyReport {
  schemaVersion: 1;
  generatedAt: string;
  scope: {
    branch: string;
    days: number;
  };
  mergeGate: GateReviewReport;
  trends: {
    flakyTrend: number;
    brokenTests: number;
    intermittentFlaky: number;
    matchedCommits: number;
    sampleRatio: number | null;
    dataConfidence: string;
  };
  flakyTagSuggestions: FlakyTagTriageReport;
  quarantineSuggestions: QuarantineSuggestionPlan;
  recommendedActions: string[];
}

function buildRecommendedActions(input: {
  mergeGate: GateReviewReport;
  flakyTagReport: FlakyTagTriageReport;
  quarantinePlan: QuarantineSuggestionPlan;
}): string[] {
  const actions: string[] = [];
  const mergeAction = input.mergeGate.recommendedAction;
  if (mergeAction === "promote") {
    actions.push("Promote merge gate to required.");
  } else if (mergeAction === "demote") {
    actions.push("Demote merge gate or remove required status.");
  } else if (mergeAction === "investigate") {
    actions.push("Investigate merge gate signals before changing policy.");
  } else {
    actions.push("Keep merge gate in its current mode.");
  }

  if (input.quarantinePlan.add.length > 0 || input.quarantinePlan.remove.length > 0) {
    actions.push(
      `Review quarantine plan: +${input.quarantinePlan.add.length} / -${input.quarantinePlan.remove.length}.`,
    );
  }

  if (
    input.flakyTagReport.summary.addCandidateCount > 0
    || input.flakyTagReport.summary.removeCandidateCount > 0
  ) {
    actions.push(
      `Review flaky-tag changes: +${input.flakyTagReport.summary.addCandidateCount} / -${input.flakyTagReport.summary.removeCandidateCount}.`,
    );
  }

  return actions;
}

export async function runOpsWeekly(input: {
  store: MetricStore;
  config: FlakerConfig;
  runner: RunnerAdapter;
  cwd?: string;
  now?: Date;
  windowDays?: number;
}): Promise<OpsWeeklyReport> {
  const now = input.now ?? new Date();
  const windowDays = input.windowDays ?? 7;
  const mergeProfile = resolveProfile("ci", input.config.profile, input.config.sampling);
  const kpi = await computeKpi(input.store, { windowDays });
  const mergeGate = buildGateReview({
    gate: "merge",
    profile: mergeProfile,
    kpi,
  });
  const quarantinePlan = await runQuarantineSuggest({
    store: input.store,
    now,
    windowDays,
    flakyRateThresholdPercentage: input.config.quarantine.flaky_rate_threshold_percentage,
    minRuns: input.config.quarantine.min_runs,
  });
  const flakyTagReport = await runFlakyTagTriage({
    store: input.store,
    runner: input.runner,
    cwd: input.cwd,
    now,
    tagPattern: input.config.runner.flaky_tag_pattern ?? "@flaky",
    windowDays,
    addThresholdPercentage: input.config.quarantine.flaky_rate_threshold_percentage,
    minRuns: input.config.quarantine.min_runs,
    removeAfterConsecutivePasses: 3,
  });

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    scope: {
      branch: "main",
      days: windowDays,
    },
    mergeGate,
    trends: {
      flakyTrend: kpi.flaky.flakyTrend,
      brokenTests: kpi.flaky.brokenTests,
      intermittentFlaky: kpi.flaky.intermittentFlaky,
      matchedCommits: kpi.sampling.matchedCommits,
      sampleRatio: kpi.sampling.sampleRatio,
      dataConfidence: kpi.data.confidence,
    },
    flakyTagSuggestions: flakyTagReport,
    quarantineSuggestions: quarantinePlan,
    recommendedActions: buildRecommendedActions({
      mergeGate,
      flakyTagReport,
      quarantinePlan,
    }),
  };
}

export function formatOpsWeeklyReport(report: OpsWeeklyReport): string {
  const lines = [
    "# Ops Weekly",
    "",
    `Scope: ${report.scope.branch}, last ${report.scope.days}d`,
    `Merge gate: ${report.mergeGate.promotionReadiness.status} (${report.mergeGate.recommendedAction})`,
    `Flaky trend: ${report.trends.flakyTrend > 0 ? `+${report.trends.flakyTrend}` : report.trends.flakyTrend}`,
    `Quarantine suggestions: +${report.quarantineSuggestions.add.length} / -${report.quarantineSuggestions.remove.length}`,
    `Flaky tag suggestions: +${report.flakyTagSuggestions.summary.addCandidateCount} / -${report.flakyTagSuggestions.summary.removeCandidateCount}`,
    "",
    "Recommended actions:",
  ];

  for (const action of report.recommendedActions) {
    lines.push(`- ${action}`);
  }

  return lines.join("\n");
}
