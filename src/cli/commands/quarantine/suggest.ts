import type { FlakyScore, MetricStore, QuarantinedTest } from "../../storage/types.js";

export type QuarantineSuggestionReason =
  | "flaky_rate_exceeded"
  | "below_threshold"
  | "no_recent_flaky_signal";

export type QuarantineSuggestionConfidence = "moderate" | "high";

export interface QuarantineSuggestionSelector {
  suite: string;
  testName: string;
  taskId?: string | null;
  filter?: string | null;
  testId?: string;
}

export interface QuarantineSuggestionEvidence {
  flakeRatePercentage: number | null;
  totalRuns: number;
  failCount?: number;
  flakyRetryCount?: number;
  currentReason?: string;
}

export interface QuarantineSuggestionItem {
  selector: QuarantineSuggestionSelector;
  reason: QuarantineSuggestionReason;
  confidence: QuarantineSuggestionConfidence;
  evidence: QuarantineSuggestionEvidence;
}

export interface QuarantineSuggestionPlan {
  version: 1;
  generatedAt: string;
  scope: {
    branch: string;
    days: number;
  };
  thresholds: {
    flakyRateThresholdPercentage: number;
    minRuns: number;
  };
  add: QuarantineSuggestionItem[];
  remove: QuarantineSuggestionItem[];
}

function compareSelector(a: QuarantineSuggestionItem, b: QuarantineSuggestionItem): number {
  return a.selector.suite.localeCompare(b.selector.suite)
    || a.selector.testName.localeCompare(b.selector.testName);
}

function confidenceFromRuns(totalRuns: number, minRuns: number): QuarantineSuggestionConfidence {
  return totalRuns >= minRuns * 2 ? "high" : "moderate";
}

function fromFlakyScore(score: FlakyScore): QuarantineSuggestionSelector {
  return {
    suite: score.suite,
    testName: score.testName,
    taskId: score.taskId,
    filter: score.filter,
    testId: score.testId,
  };
}

function fromQuarantined(test: QuarantinedTest): QuarantineSuggestionSelector {
  return {
    suite: test.suite,
    testName: test.testName,
    taskId: test.taskId,
    filter: test.filter,
    testId: test.testId,
  };
}

export async function runQuarantineSuggest(input: {
  store: MetricStore;
  now?: Date;
  branch?: string;
  windowDays?: number;
  flakyRateThresholdPercentage?: number;
  minRuns?: number;
}): Promise<QuarantineSuggestionPlan> {
  const now = input.now ?? new Date();
  const branch = input.branch ?? "main";
  const windowDays = input.windowDays ?? 30;
  const flakyRateThresholdPercentage = input.flakyRateThresholdPercentage ?? 30;
  const minRuns = input.minRuns ?? 5;

  const [flaky, quarantined] = await Promise.all([
    input.store.queryFlakyTests({ windowDays, now: input.now }),
    input.store.queryQuarantined(),
  ]);

  const quarantinedById = new Map(quarantined.map((entry) => [entry.testId, entry]));
  const flakyById = new Map(flaky.map((entry) => [entry.testId, entry]));

  const add: QuarantineSuggestionItem[] = [];
  const remove: QuarantineSuggestionItem[] = [];

  for (const score of flaky) {
    if (score.totalRuns < minRuns) continue;
    const current = quarantinedById.get(score.testId);
    if (score.flakyRate >= flakyRateThresholdPercentage && !current) {
      add.push({
        selector: fromFlakyScore(score),
        reason: "flaky_rate_exceeded",
        confidence: confidenceFromRuns(score.totalRuns, minRuns),
        evidence: {
          flakeRatePercentage: score.flakyRate,
          totalRuns: score.totalRuns,
          failCount: score.failCount,
          flakyRetryCount: score.flakyRetryCount,
        },
      });
    }
    if (current && score.flakyRate < flakyRateThresholdPercentage) {
      remove.push({
        selector: fromQuarantined(current),
        reason: "below_threshold",
        confidence: confidenceFromRuns(score.totalRuns, minRuns),
        evidence: {
          flakeRatePercentage: score.flakyRate,
          totalRuns: score.totalRuns,
          failCount: score.failCount,
          flakyRetryCount: score.flakyRetryCount,
          currentReason: current.reason,
        },
      });
    }
  }

  for (const entry of quarantined) {
    if (flakyById.has(entry.testId)) continue;
    remove.push({
      selector: fromQuarantined(entry),
      reason: "no_recent_flaky_signal",
      confidence: "moderate",
      evidence: {
        flakeRatePercentage: null,
        totalRuns: 0,
        currentReason: entry.reason,
      },
    });
  }

  add.sort(compareSelector);
  remove.sort(compareSelector);

  return {
    version: 1,
    generatedAt: now.toISOString(),
    scope: {
      branch,
      days: windowDays,
    },
    thresholds: {
      flakyRateThresholdPercentage,
      minRuns,
    },
    add,
    remove,
  };
}

export function formatQuarantineSuggestionPlan(plan: QuarantineSuggestionPlan): string {
  const lines = [
    "Quarantine Suggest",
    `Scope: ${plan.scope.branch}, last ${plan.scope.days}d`,
    `Thresholds: flaky_rate >= ${plan.thresholds.flakyRateThresholdPercentage}%, min_runs >= ${plan.thresholds.minRuns}`,
    `Add: ${plan.add.length}`,
    `Remove: ${plan.remove.length}`,
  ];

  if (plan.add.length > 0) {
    lines.push("", "Add candidates:");
    for (const item of plan.add) {
      lines.push(
        `- ${item.selector.suite} :: ${item.selector.testName} (${item.evidence.flakeRatePercentage}% / ${item.evidence.totalRuns} runs)`,
      );
    }
  }

  if (plan.remove.length > 0) {
    lines.push("", "Remove candidates:");
    for (const item of plan.remove) {
      const rate = item.evidence.flakeRatePercentage == null ? "no recent signal" : `${item.evidence.flakeRatePercentage}%`;
      lines.push(
        `- ${item.selector.suite} :: ${item.selector.testName} (${rate})`,
      );
    }
  }

  return lines.join("\n");
}
