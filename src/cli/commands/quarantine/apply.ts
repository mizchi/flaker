import type { MetricStore } from "../../storage/types.js";
import type { QuarantineSuggestionPlan, QuarantineSuggestionSelector } from "./suggest.js";
import { resolveTestIdentity } from "../../identity.js";

export interface QuarantineApplyResult {
  added: number;
  removed: number;
  skippedAdds: number;
  skippedRemoves: number;
  createdIssues: number;
}

export interface QuarantineApplyIssueInput {
  selector: QuarantineSuggestionSelector;
  flakeRatePercentage: number;
  totalRuns: number;
  reason: string;
}

function toSelectorKey(selector: QuarantineSuggestionSelector): string {
  return resolveTestIdentity(selector).testId;
}

function assertSupportedPlan(plan: QuarantineSuggestionPlan): void {
  if (plan.version !== 1) {
    throw new Error(`Unsupported quarantine plan version: ${plan.version}`);
  }
}

export async function runQuarantineApply(input: {
  store: MetricStore;
  plan: QuarantineSuggestionPlan;
  createIssue?: (input: QuarantineApplyIssueInput) => string | null;
}): Promise<QuarantineApplyResult> {
  assertSupportedPlan(input.plan);

  const current = await input.store.queryQuarantined();
  const currentKeys = new Set(current.map((entry) => toSelectorKey(entry)));
  let added = 0;
  let removed = 0;
  let skippedAdds = 0;
  let skippedRemoves = 0;
  let createdIssues = 0;

  for (const item of input.plan.add) {
    const key = toSelectorKey(item.selector);
    if (currentKeys.has(key)) {
      skippedAdds++;
      continue;
    }
    await input.store.addQuarantine(item.selector, `plan:${item.reason}`);
    currentKeys.add(key);
    added++;

    if (input.createIssue) {
      const url = input.createIssue({
        selector: item.selector,
        flakeRatePercentage: item.evidence.flakeRatePercentage ?? 0,
        totalRuns: item.evidence.totalRuns,
        reason: item.reason,
      });
      if (url) {
        createdIssues++;
      }
    }
  }

  for (const item of input.plan.remove) {
    const key = toSelectorKey(item.selector);
    if (!currentKeys.has(key)) {
      skippedRemoves++;
      continue;
    }
    await input.store.removeQuarantine(item.selector);
    currentKeys.delete(key);
    removed++;
  }

  return {
    added,
    removed,
    skippedAdds,
    skippedRemoves,
    createdIssues,
  };
}

export function formatQuarantineApplyResult(result: QuarantineApplyResult): string {
  return [
    "Quarantine Apply",
    `added=${result.added}`,
    `removed=${result.removed}`,
    `skippedAdds=${result.skippedAdds}`,
    `skippedRemoves=${result.skippedRemoves}`,
    `issues=${result.createdIssues}`,
  ].join(" ");
}
