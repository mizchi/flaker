import type { FlakerConfig } from "../../config.js";
import type { FlakerKpi } from "../analyze/kpi.js";

export interface RepoProbe {
  hasGitRemote: boolean;
  hasGithubToken: boolean;
  hasLocalHistory: boolean;
}

export type PlannedAction =
  | { kind: "collect_ci"; reason: string; windowDays: number }
  | { kind: "calibrate"; reason: string }
  | { kind: "cold_start_run"; reason: string }
  | { kind: "quarantine_apply"; reason: string };

export interface PlannerInput {
  config: FlakerConfig;
  kpi: FlakerKpi;
  probe: RepoProbe;
}

export function planApply(input: PlannerInput): PlannedAction[] {
  const actions: PlannedAction[] = [];
  const confidence = input.kpi.data.confidence;
  const hasUsefulHistory = confidence === "moderate" || confidence === "high";

  if (input.probe.hasGithubToken) {
    actions.push({
      kind: "collect_ci",
      reason: input.kpi.data.staleDays == null
        ? "no prior collect; pulling initial history"
        : `history stale by ${input.kpi.data.staleDays} day(s)`,
      windowDays: 30,
    });
  }

  if (hasUsefulHistory) {
    actions.push({ kind: "calibrate", reason: `data confidence=${confidence}; re-tuning sampling` });
  }

  if (!input.probe.hasLocalHistory) {
    actions.push({
      kind: "cold_start_run",
      reason: "no local history recorded; seeding via iteration gate",
    });
  }

  if (input.config.quarantine.auto && hasUsefulHistory) {
    actions.push({
      kind: "quarantine_apply",
      reason: "quarantine.auto=true; applying suggested quarantine plan",
    });
  }

  return actions;
}
