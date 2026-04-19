import type { PromotionThresholds } from "../../config.js";

export interface DesiredState {
  promotion: PromotionThresholds;
  quarantineAuto: boolean;
  samplingStrategy: string;
  hasGithubToken: boolean;
}

export interface ObservedState {
  matchedCommits: number;
  falseNegativeRatePercentage: number | null;
  passCorrelationPercentage: number | null;
  holdoutFnrPercentage: number | null;
  dataConfidence: "insufficient" | "low" | "moderate" | "high";
  hasLocalHistory: boolean;
  staleDays: number | null;
  pendingQuarantineCount: number;
}

export type StateDiffField =
  | { kind: "matched_commits"; actual: number; desired: number }
  | { kind: "false_negative_rate"; actual: number | null; desired: number }
  | { kind: "pass_correlation"; actual: number | null; desired: number }
  | { kind: "holdout_fnr"; actual: number | null; desired: number }
  | {
      kind: "data_confidence";
      actual: ObservedState["dataConfidence"];
      desired: PromotionThresholds["data_confidence_min"];
    }
  | { kind: "quarantine_pending"; actual: number; desired: 0 }
  | { kind: "local_history_missing"; actual: false; desired: true }
  | { kind: "history_stale"; actual: number; desired: 0 };

export interface StateDiff {
  ok: boolean;
  drifts: StateDiffField[];
}

const CONFIDENCE_RANK = { insufficient: 0, low: 1, moderate: 2, high: 3 } as const;

export function computeStateDiff(desired: DesiredState, observed: ObservedState): StateDiff {
  const drifts: StateDiffField[] = [];

  if (observed.matchedCommits < desired.promotion.matched_commits_min) {
    drifts.push({ kind: "matched_commits", actual: observed.matchedCommits, desired: desired.promotion.matched_commits_min });
  }
  if (observed.falseNegativeRatePercentage == null || observed.falseNegativeRatePercentage > desired.promotion.false_negative_rate_max_percentage) {
    drifts.push({ kind: "false_negative_rate", actual: observed.falseNegativeRatePercentage, desired: desired.promotion.false_negative_rate_max_percentage });
  }
  if (observed.passCorrelationPercentage == null || observed.passCorrelationPercentage < desired.promotion.pass_correlation_min_percentage) {
    drifts.push({ kind: "pass_correlation", actual: observed.passCorrelationPercentage, desired: desired.promotion.pass_correlation_min_percentage });
  }
  if (observed.holdoutFnrPercentage == null || observed.holdoutFnrPercentage > desired.promotion.holdout_fnr_max_percentage) {
    drifts.push({ kind: "holdout_fnr", actual: observed.holdoutFnrPercentage, desired: desired.promotion.holdout_fnr_max_percentage });
  }
  if (CONFIDENCE_RANK[observed.dataConfidence] < CONFIDENCE_RANK[desired.promotion.data_confidence_min]) {
    drifts.push({ kind: "data_confidence", actual: observed.dataConfidence, desired: desired.promotion.data_confidence_min });
  }
  if (desired.quarantineAuto && observed.pendingQuarantineCount > 0) {
    drifts.push({ kind: "quarantine_pending", actual: observed.pendingQuarantineCount, desired: 0 });
  }
  if (!observed.hasLocalHistory) {
    drifts.push({ kind: "local_history_missing", actual: false, desired: true });
  }
  if (desired.hasGithubToken && observed.staleDays != null && observed.staleDays > 0) {
    drifts.push({ kind: "history_stale", actual: observed.staleDays, desired: 0 });
  }

  return { ok: drifts.length === 0, drifts };
}
