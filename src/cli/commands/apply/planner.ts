import type { FlakerConfig } from "../../config.js";
import type { FlakerKpi } from "../analyze/kpi.js";
import { computeStateDiff, type DesiredState, type ObservedState, type StateDiff, type StateDiffField } from "./state.js";

export interface RepoProbe {
  hasGitRemote: boolean;
  hasGithubToken: boolean;
  hasLocalHistory: boolean;
}

export type PlannedAction =
  | { kind: "collect_ci"; reason: string; windowDays: number; driftRef?: StateDiffField[] }
  | { kind: "calibrate"; reason: string; driftRef?: StateDiffField[] }
  | { kind: "cold_start_run"; reason: string; driftRef?: StateDiffField[] }
  | { kind: "quarantine_apply"; reason: string; driftRef?: StateDiffField[] };

export interface PlannerInput {
  config: FlakerConfig;
  kpi: FlakerKpi;
  probe: RepoProbe;
}

export interface PlannerResult {
  diff: StateDiff;
  actions: PlannedAction[];
}

export function planApply(input: PlannerInput): PlannerResult {
  const actions: PlannedAction[] = [];
  const confidence = input.kpi.data.confidence;
  const hasUsefulHistory = confidence === "moderate" || confidence === "high";

  // Build DesiredState from config and probe
  const desired: DesiredState = {
    promotion: input.config.promotion,
    quarantineAuto: input.config.quarantine.auto,
    samplingStrategy: input.config.sampling?.strategy ?? "hybrid",
    hasGithubToken: input.probe.hasGithubToken,
  };

  // Build ObservedState from kpi and probe.
  // falseNegativeRate, passCorrelation, holdoutFNR in KPI are ratios (0.0-1.0);
  // ObservedState expects percentage values (0-100) per the 0.7.0 drift comment.
  const observed: ObservedState = {
    matchedCommits: input.kpi.sampling.matchedCommits,
    falseNegativeRatePercentage: input.kpi.sampling.falseNegativeRate != null
      ? input.kpi.sampling.falseNegativeRate * 100
      : null,
    passCorrelationPercentage: input.kpi.sampling.passCorrelation != null
      ? input.kpi.sampling.passCorrelation * 100
      : null,
    holdoutFnrPercentage: input.kpi.sampling.holdoutFNR != null
      ? input.kpi.sampling.holdoutFNR * 100
      : null,
    dataConfidence: input.kpi.data.confidence,
    hasLocalHistory: input.probe.hasLocalHistory,
    staleDays: input.kpi.data.staleDays,
    // pendingQuarantineCount: placeholder for 0.9.0 Task 2; the real count
    // will be threaded through once Task 5-6 wires the quarantine plan summary.
    pendingQuarantineCount: 0,
  };

  // Compute the state diff
  const diff = computeStateDiff(desired, observed);

  // Derive actions from the diff

  // collect_ci: triggered when github token available (stale or missing history)
  if (input.probe.hasGithubToken) {
    const collectDrifts = diff.drifts.filter(
      (d) => d.kind === "history_stale" || d.kind === "local_history_missing",
    );
    actions.push({
      kind: "collect_ci",
      reason: input.kpi.data.staleDays == null
        ? "no prior collect; pulling initial history"
        : `history stale by ${input.kpi.data.staleDays} day(s)`,
      windowDays: 30,
      driftRef: collectDrifts,
    });
  }

  // calibrate: triggered when data confidence is moderate or high
  if (hasUsefulHistory) {
    const calibrateDrifts = diff.drifts.filter(
      (d) =>
        d.kind === "data_confidence" ||
        d.kind === "matched_commits" ||
        d.kind === "false_negative_rate" ||
        d.kind === "pass_correlation" ||
        d.kind === "holdout_fnr",
    );
    actions.push({
      kind: "calibrate",
      reason: `data confidence=${confidence}; re-tuning sampling`,
      driftRef: calibrateDrifts,
    });
  }

  // cold_start_run: triggered when no local history
  if (!input.probe.hasLocalHistory) {
    const coldStartDrifts = diff.drifts.filter(
      (d) => d.kind === "local_history_missing",
    );
    actions.push({
      kind: "cold_start_run",
      reason: "no local history recorded; seeding via iteration gate",
      driftRef: coldStartDrifts,
    });
  }

  // quarantine_apply: triggered when auto quarantine is enabled and there is useful history
  if (input.config.quarantine.auto && hasUsefulHistory) {
    const quarantineDrifts = diff.drifts.filter(
      (d) => d.kind === "quarantine_pending",
    );
    actions.push({
      kind: "quarantine_apply",
      reason: "quarantine.auto=true; applying suggested quarantine plan",
      driftRef: quarantineDrifts,
    });
  }

  return { diff, actions };
}
