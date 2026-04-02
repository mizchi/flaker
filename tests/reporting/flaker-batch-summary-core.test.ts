import { describe, expect, it } from "vitest";
import type { PlaywrightSummary } from "../../src/cli/reporting/playwright-report-contract.js";
import type { FlakerTaskSummaryReport } from "../../src/cli/reporting/flaker-task-summary-contract.js";
import {
  buildFlakerBatchSummary,
  renderFlakerBatchSummaryMarkdown,
} from "../../src/cli/reporting/flaker-batch-summary-core.js";

describe("buildFlakerBatchSummary", () => {
  it("aggregates task summaries from loaded reports", () => {
    const summary = buildFlakerBatchSummary({
      playwrightSummaries: new Map([
        ["paint-vrt", {
          totals: {
            total: 10,
            passed: 9,
            failed: 1,
            flaky: 0,
            skipped: 0,
            timedout: 0,
            interrupted: 0,
            unknown: 0,
            retries: 1,
            durationMs: 100,
          },
        } as PlaywrightSummary],
        ["wpt-vrt", {
          totals: {
            total: 20,
            passed: 20,
            failed: 0,
            flaky: 2,
            skipped: 0,
            timedout: 0,
            interrupted: 0,
            unknown: 0,
            retries: 2,
            durationMs: 200,
          },
        } as PlaywrightSummary],
      ]),
      flakerSummaries: new Map([
        ["paint-vrt", {
          eval: {
            healthScore: 72,
            resolution: { newFlaky: 1 },
          },
          reason: {
            summary: { urgentFixes: 1 },
          },
        } as FlakerTaskSummaryReport],
      ]),
    });

    expect(summary.taskCount).toBe(2);
    expect(summary.failedTasks).toBe(1);
    expect(summary.flakyTasks).toBe(1);
    expect(summary.totalTests).toBe(30);
    expect(summary.tasks).toEqual([
      {
        taskId: "paint-vrt",
        totalTests: 10,
        failed: 1,
        flaky: 0,
        skipped: 0,
        healthScore: 72,
        newFlaky: 1,
        urgentFixes: 1,
        status: "failed",
      },
      {
        taskId: "wpt-vrt",
        totalTests: 20,
        failed: 0,
        flaky: 2,
        skipped: 0,
        healthScore: undefined,
        newFlaky: undefined,
        urgentFixes: undefined,
        status: "ok",
      },
    ]);
  });

  it("marks tasks without playwright summary as missing", () => {
    const summary = buildFlakerBatchSummary({
      playwrightSummaries: new Map(),
      flakerSummaries: new Map([
        ["paint-vrt", {
          schemaVersion: 1,
          generatedAt: "2026-04-02T00:00:00.000Z",
          taskId: "paint-vrt",
          workspaceDir: "/tmp/paint-vrt",
          eval: {
            dataSufficiency: {
              totalRuns: 1,
              totalResults: 1,
              uniqueTests: 1,
              firstDate: null,
              lastDate: null,
              avgRunsPerTest: 1,
            },
            detection: {
              flakyTests: 0,
              trueFlakyTests: 0,
              quarantinedTests: 0,
              distribution: [],
            },
            resolution: {
              resolvedFlaky: 0,
              newFlaky: 0,
              mttdDays: null,
              mttrDays: null,
            },
            healthScore: 100,
          },
          reason: {
            classifications: [],
            patterns: [],
            riskPredictions: [],
            summary: {
              totalAnalyzed: 0,
              trueFlakyCount: 0,
              regressionCount: 0,
              quarantineRecommended: 0,
              urgentFixes: 0,
            },
          },
        }],
      ]),
    });

    expect(summary.tasks).toEqual([
      {
        taskId: "paint-vrt",
        totalTests: 0,
        failed: 0,
        flaky: 0,
        skipped: 0,
        status: "missing",
      },
    ]);
  });
});

describe("renderFlakerBatchSummaryMarkdown", () => {
  it("renders aggregate overview", () => {
    const markdown = renderFlakerBatchSummaryMarkdown({
      schemaVersion: 1,
      generatedAt: "2026-04-02T00:00:00.000Z",
      taskCount: 2,
      failedTasks: 1,
      flakyTasks: 1,
      healthyTasks: 0,
      totalTests: 30,
      tasks: [
        {
          taskId: "paint-vrt",
          totalTests: 10,
          failed: 1,
          flaky: 0,
          skipped: 0,
          healthScore: 72,
          newFlaky: 1,
          urgentFixes: 1,
          status: "failed",
        },
      ],
    });

    expect(markdown).toContain("# Flaker Daily Batch Summary");
    expect(markdown).toContain("| Failed tasks | 1 |");
    expect(markdown).toContain("| paint-vrt | failed | 10 | 1 | 0 | 72 | 1 | 1 |");
  });
});
