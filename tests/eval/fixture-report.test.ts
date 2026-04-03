import { describe, it, expect } from "vitest";
import { formatEvalFixtureReport, type EvalFixtureReport } from "../../src/cli/eval/fixture-report.js";
import type { EvalStrategyResult } from "../../src/cli/eval/fixture-evaluator.js";
import type { FixtureConfig } from "../../src/cli/eval/fixture-generator.js";

describe("formatEvalFixtureReport", () => {
  it("formats a readable markdown table", () => {
    const config: FixtureConfig = {
      testCount: 500,
      commitCount: 100,
      flakyRate: 0.1,
      coFailureStrength: 0.8,
      filesPerCommit: 2,
      testsPerFile: 5,
      samplePercentage: 20,
      seed: 42,
    };

    const results: EvalStrategyResult[] = [
      {
        strategy: "random",
        recall: 0.2, precision: 0.05, f1: 0.08,
        falseNegativeRate: 0.8, sampleRatio: 0.2, efficiency: 1.0,
        totalFailures: 100, detectedFailures: 20, totalSampled: 400,
      },
      {
        strategy: "weighted",
        recall: 0.35, precision: 0.08, f1: 0.13,
        falseNegativeRate: 0.65, sampleRatio: 0.2, efficiency: 1.75,
        totalFailures: 100, detectedFailures: 35, totalSampled: 400,
      },
      {
        strategy: "weighted+co-failure",
        recall: 0.72, precision: 0.15, f1: 0.25,
        falseNegativeRate: 0.28, sampleRatio: 0.2, efficiency: 3.6,
        totalFailures: 100, detectedFailures: 72, totalSampled: 400,
      },
    ];

    const report: EvalFixtureReport = { config, results };
    const output = formatEvalFixtureReport(report);

    expect(output).toContain("Evaluation Report");
    expect(output).toContain("random");
    expect(output).toContain("weighted+co-failure");
    expect(output).toContain("Recall");
    expect(output).toContain("Efficiency");
  });
});
