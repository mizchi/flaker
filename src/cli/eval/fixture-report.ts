import type { FixtureConfig } from "./fixture-generator.js";
import type { EvalStrategyResult } from "./fixture-evaluator.js";

export interface EvalFixtureReport {
  config: FixtureConfig;
  results: EvalStrategyResult[];
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function pad(s: string, width: number): string {
  return s.padEnd(width);
}

export function formatEvalFixtureReport(report: EvalFixtureReport): string {
  const c = report.config;
  const lines: string[] = [
    "# Evaluation Report",
    "",
    `Config: tests=${c.testCount}, commits=${c.commitCount}, flaky=${pct(c.flakyRate)}, co-failure=${c.coFailureStrength}, sample=${c.samplePercentage}%`,
    "",
    `| ${pad("Strategy", 22)} | ${pad("Recall", 8)} | ${pad("Prec", 8)} | ${pad("F1", 6)} | ${pad("FNR", 8)} | ${pad("Sample%", 8)} | ${pad("Efficiency", 10)} |`,
    `|${"-".repeat(24)}|${"-".repeat(10)}|${"-".repeat(10)}|${"-".repeat(8)}|${"-".repeat(10)}|${"-".repeat(10)}|${"-".repeat(12)}|`,
  ];

  for (const r of report.results) {
    lines.push(
      `| ${pad(r.strategy, 22)} | ${pad(pct(r.recall), 8)} | ${pad(pct(r.precision), 8)} | ${pad(r.f1.toFixed(2), 6)} | ${pad(pct(r.falseNegativeRate), 8)} | ${pad(pct(r.sampleRatio), 8)} | ${pad(r.efficiency.toFixed(2), 10)} |`,
    );
  }

  lines.push("", `Efficiency = Recall / Sample%. >1.0 means better than random.`);
  return lines.join("\n");
}

export function formatSweepReport(reports: EvalFixtureReport[]): string {
  const lines: string[] = [
    "# Co-failure Strength Sweep",
    "",
    `| ${pad("Strength", 10)} | ${pad("Random", 8)} | ${pad("Weighted", 10)} | ${pad("W+CoFail", 10)} | ${pad("Gain", 6)} |`,
    `|${"-".repeat(12)}|${"-".repeat(10)}|${"-".repeat(12)}|${"-".repeat(12)}|${"-".repeat(8)}|`,
  ];

  for (const report of reports) {
    const random = report.results.find((r) => r.strategy === "random")!;
    const weighted = report.results.find((r) => r.strategy === "weighted")!;
    const coFailure = report.results.find((r) => r.strategy === "weighted+co-failure")!;
    const gain = random.recall > 0
      ? `${((coFailure.recall / random.recall - 1) * 100).toFixed(0)}%`
      : "N/A";

    lines.push(
      `| ${pad(report.config.coFailureStrength.toFixed(2), 10)} | ${pad(pct(random.recall), 8)} | ${pad(pct(weighted.recall), 10)} | ${pad(pct(coFailure.recall), 10)} | ${pad(gain, 6)} |`,
    );
  }

  return lines.join("\n");
}
