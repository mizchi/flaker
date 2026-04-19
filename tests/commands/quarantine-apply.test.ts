import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import {
  formatQuarantineApplyResult,
  runQuarantineApply,
} from "../../src/cli/commands/quarantine/apply.js";
import type { QuarantineSuggestionPlan } from "../../src/cli/commands/quarantine/suggest.js";

describe("quarantine apply", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("applies add/remove operations idempotently", async () => {
    await store.addQuarantine(
      { suite: "tests/remove.spec.ts", testName: "remove candidate" },
      "manual",
    );

    const plan: QuarantineSuggestionPlan = {
      version: 1,
      generatedAt: "2026-04-19T00:00:00.000Z",
      scope: { branch: "main", days: 30 },
      thresholds: { flakyRateThresholdPercentage: 30, minRuns: 5 },
      add: [
        {
          selector: {
            suite: "tests/add.spec.ts",
            testName: "add candidate",
          },
          reason: "flaky_rate_exceeded",
          confidence: "moderate",
          evidence: {
            flakeRatePercentage: 60,
            totalRuns: 5,
            failCount: 2,
            flakyRetryCount: 1,
          },
        },
      ],
      remove: [
        {
          selector: {
            suite: "tests/remove.spec.ts",
            testName: "remove candidate",
          },
          reason: "below_threshold",
          confidence: "moderate",
          evidence: {
            flakeRatePercentage: 20,
            totalRuns: 5,
            currentReason: "manual",
          },
        },
      ],
    };

    const first = await runQuarantineApply({ store, plan });
    expect(first.added).toBe(1);
    expect(first.removed).toBe(1);
    expect(first.skippedAdds).toBe(0);
    expect(first.skippedRemoves).toBe(0);

    const second = await runQuarantineApply({ store, plan });
    expect(second.added).toBe(0);
    expect(second.removed).toBe(0);
    expect(second.skippedAdds).toBe(1);
    expect(second.skippedRemoves).toBe(1);

    const current = await store.queryQuarantined();
    expect(current).toEqual([
      expect.objectContaining({
        suite: "tests/add.spec.ts",
        testName: "add candidate",
        reason: "plan:flaky_rate_exceeded",
      }),
    ]);
  });

  it("optionally creates issues for newly added entries", async () => {
    const createIssue = vi.fn(() => "https://github.com/owner/repo/issues/1");
    const plan: QuarantineSuggestionPlan = {
      version: 1,
      generatedAt: "2026-04-19T00:00:00.000Z",
      scope: { branch: "main", days: 30 },
      thresholds: { flakyRateThresholdPercentage: 30, minRuns: 5 },
      add: [
        {
          selector: {
            suite: "tests/add.spec.ts",
            testName: "add candidate",
          },
          reason: "flaky_rate_exceeded",
          confidence: "moderate",
          evidence: {
            flakeRatePercentage: 60,
            totalRuns: 5,
          },
        },
      ],
      remove: [],
    };

    const result = await runQuarantineApply({
      store,
      plan,
      createIssue,
    });

    expect(createIssue).toHaveBeenCalledTimes(1);
    expect(result.createdIssues).toBe(1);
    expect(formatQuarantineApplyResult(result)).toContain("issues=1");
  });
});
