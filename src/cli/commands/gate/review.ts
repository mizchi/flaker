import type { FlakerKpi } from "../analyze/kpi.js";
import type { GateName } from "../../gate.js";
import type { ResolvedProfile } from "../../profile-compat.js";

export type GateReviewCheckStatus = "pass" | "fail";
export type GateReviewStatus = "ready" | "insufficient_data" | "investigate" | "demote";
export type GateRecommendedAction = "promote" | "keep" | "demote" | "investigate";
export type GateReviewRisk = "low" | "medium" | "high";

export interface GateReviewCheck {
  name: "matched_commits" | "false_negative_rate" | "pass_correlation" | "data_confidence";
  status: GateReviewCheckStatus;
  actual: number | string | null;
  target: string;
}

export interface GateReviewReport {
  gate: GateName;
  backingProfile: string;
  strategy: string;
  budget: {
    timeSeconds: number | null;
    samplePercentage: number | null;
    holdoutRatio: number | null;
  };
  kpi: {
    matchedCommits: number;
    falseNegativeRateRatio: number | null;
    passCorrelationRatio: number | null;
    dataConfidence: FlakerKpi["data"]["confidence"];
  };
  promotionReadiness: {
    status: GateReviewStatus;
    checks: GateReviewCheck[];
  };
  demotionRisk: {
    status: GateReviewRisk;
    reasons: string[];
  };
  recommendedAction: GateRecommendedAction;
}

interface GateReviewThresholds {
  minMatchedCommits: number;
  maxFalseNegativeRateRatio: number;
  minPassCorrelationRatio: number;
  minDataConfidence: FlakerKpi["data"]["confidence"];
}

const DEFAULT_THRESHOLDS: GateReviewThresholds = {
  minMatchedCommits: 20,
  maxFalseNegativeRateRatio: 0.05,
  minPassCorrelationRatio: 0.95,
  minDataConfidence: "moderate",
};

const CONFIDENCE_RANK: Record<FlakerKpi["data"]["confidence"], number> = {
  insufficient: 0,
  low: 1,
  moderate: 2,
  high: 3,
};

function toRatio(value: number | null | undefined): number | null {
  if (value == null) return null;
  return Number((value / 100).toFixed(4));
}

function formatPercent(ratio: number | null): string {
  if (ratio == null) return "N/A";
  return `${Number((ratio * 100).toFixed(1))}%`;
}

function confidenceAtLeast(
  actual: FlakerKpi["data"]["confidence"],
  expected: FlakerKpi["data"]["confidence"],
): boolean {
  return CONFIDENCE_RANK[actual] >= CONFIDENCE_RANK[expected];
}

export function buildGateReview(input: {
  gate: GateName;
  profile: ResolvedProfile;
  kpi: FlakerKpi;
  thresholds?: Partial<GateReviewThresholds>;
}): GateReviewReport {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
  const matchedCommits = input.kpi.sampling.matchedCommits;
  const falseNegativeRateRatio = toRatio(input.kpi.sampling.falseNegativeRate);
  const passCorrelationRatio = toRatio(input.kpi.sampling.passCorrelation);
  const dataConfidence = input.kpi.data.confidence;

  const checks: GateReviewCheck[] = [
    {
      name: "matched_commits",
      status: matchedCommits >= thresholds.minMatchedCommits ? "pass" : "fail",
      actual: matchedCommits,
      target: `>= ${thresholds.minMatchedCommits}`,
    },
    {
      name: "false_negative_rate",
      status: falseNegativeRateRatio != null && falseNegativeRateRatio <= thresholds.maxFalseNegativeRateRatio
        ? "pass"
        : "fail",
      actual: falseNegativeRateRatio,
      target: `<= ${formatPercent(thresholds.maxFalseNegativeRateRatio)}`,
    },
    {
      name: "pass_correlation",
      status: passCorrelationRatio != null && passCorrelationRatio >= thresholds.minPassCorrelationRatio
        ? "pass"
        : "fail",
      actual: passCorrelationRatio,
      target: `>= ${formatPercent(thresholds.minPassCorrelationRatio)}`,
    },
    {
      name: "data_confidence",
      status: confidenceAtLeast(dataConfidence, thresholds.minDataConfidence) ? "pass" : "fail",
      actual: dataConfidence,
      target: `>= ${thresholds.minDataConfidence}`,
    },
  ];

  const demotionReasons: string[] = [];
  if (falseNegativeRateRatio == null || falseNegativeRateRatio > thresholds.maxFalseNegativeRateRatio) {
    demotionReasons.push(
      `false negative rate ${formatPercent(falseNegativeRateRatio)} is above ${formatPercent(thresholds.maxFalseNegativeRateRatio)}`,
    );
  }
  if (passCorrelationRatio == null || passCorrelationRatio < thresholds.minPassCorrelationRatio) {
    demotionReasons.push(
      `pass correlation ${formatPercent(passCorrelationRatio)} is below ${formatPercent(thresholds.minPassCorrelationRatio)}`,
    );
  }

  const confidenceReason = !confidenceAtLeast(dataConfidence, thresholds.minDataConfidence)
    ? [`data confidence is ${dataConfidence}`]
    : [];

  let status: GateReviewStatus;
  if (matchedCommits < thresholds.minMatchedCommits) {
    status = "insufficient_data";
  } else if (demotionReasons.length > 0) {
    status = "demote";
  } else if (confidenceReason.length > 0) {
    status = "investigate";
  } else {
    status = "ready";
  }

  const recommendedAction: GateRecommendedAction = status === "ready"
    ? (input.gate === "merge" ? "promote" : "keep")
    : status === "insufficient_data"
    ? "keep"
    : status === "demote"
    ? "demote"
    : "investigate";

  const reasons = status === "demote"
    ? demotionReasons
    : status === "investigate"
    ? confidenceReason
    : status === "insufficient_data"
    ? [`matched commits ${matchedCommits} < ${thresholds.minMatchedCommits}`]
    : [];

  return {
    gate: input.gate,
    backingProfile: input.profile.name,
    strategy: input.profile.strategy,
    budget: {
      timeSeconds: input.profile.max_duration_seconds ?? null,
      samplePercentage: input.profile.sample_percentage ?? null,
      holdoutRatio: input.profile.holdout_ratio ?? null,
    },
    kpi: {
      matchedCommits,
      falseNegativeRateRatio,
      passCorrelationRatio,
      dataConfidence,
    },
    promotionReadiness: {
      status,
      checks,
    },
    demotionRisk: {
      status: status === "demote" ? "high" : status === "investigate" ? "medium" : "low",
      reasons,
    },
    recommendedAction,
  };
}

export function formatGateReview(report: GateReviewReport): string {
  const lines = [
    `Gate Review: ${report.gate}`,
    `Backing profile: ${report.backingProfile}`,
    `Strategy: ${report.strategy}`,
    `Promotion readiness: ${report.promotionReadiness.status}`,
    `Recommended action: ${report.recommendedAction}`,
    "",
    "Signals:",
    `- matched commits: ${report.kpi.matchedCommits}`,
    `- false negative rate: ${formatPercent(report.kpi.falseNegativeRateRatio)}`,
    `- pass correlation: ${formatPercent(report.kpi.passCorrelationRatio)}`,
    `- data confidence: ${report.kpi.dataConfidence}`,
  ];
  if (report.demotionRisk.reasons.length > 0) {
    lines.push("", "Reasons:");
    for (const reason of report.demotionRisk.reasons) {
      lines.push(`- ${reason}`);
    }
  }
  return lines.join("\n");
}
