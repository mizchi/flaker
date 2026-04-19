import type { Command } from "commander";
import {
  analyzeReasonAction,
  analyzeInsightsAction,
  analyzeClusterAction,
  analyzeBundleAction,
  analyzeContextAction,
} from "./analyze.js";

export function registerExplainCommands(program: Command): void {
  const explain = program
    .command("explain")
    .description("Explain flaker findings (reason | insights | cluster | bundle | context)");

  explain
    .command("reason")
    .description("Analyze flaky tests and produce actionable recommendations")
    .option("--window <days>", "Analysis window in days", "30")
    .option("--json", "Output raw JSON report")
    .action(analyzeReasonAction);

  explain
    .command("insights")
    .description("Compare CI vs local failure patterns to identify environment-specific issues")
    .option("--window-days <days>", "Analysis window in days", "90")
    .option("--top <n>", "Number of tests to show per category", "20")
    .action(analyzeInsightsAction);

  explain
    .command("cluster")
    .description("Inspect clusters of tests that frequently fail together")
    .option("--window-days <days>", "Analysis window in days", "90")
    .option("--min-co-failures <n>", "Minimum shared failing runs", "2")
    .option("--min-co-rate <ratio>", "Minimum co-failure rate as ratio (0.0-1.0)", "0.8")
    .option("--top <n>", "Number of clusters to show", "20")
    .action(analyzeClusterAction);

  explain
    .command("bundle")
    .description("Export a machine-readable analysis bundle for AI consumers")
    .option("--window-days <days>", "Analysis window in days", "30")
    .option("--output <file>", "Write bundle JSON to a file")
    .action(analyzeBundleAction);

  explain
    .command("context")
    .description("Show environment data and strategy characteristics for decision-making")
    .option("--json", "Output as JSON for programmatic consumption")
    .action(analyzeContextAction);
}
