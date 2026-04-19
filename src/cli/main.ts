#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { setupInitAction } from "./commands/setup/init.js";
import { execRunAction, RUN_COMMAND_HELP } from "./commands/run.js";
import { registerImportCommands } from "./categories/import.js";
import { registerReportCommands } from "./categories/report.js";
import { statusAction, analyzeQueryAction } from "./categories/analyze.js";
import { registerExplainCommands } from "./categories/explain.js";
import { registerOpsCommands } from "./categories/ops.js";
import { registerDebugCommands, debugDoctorAction } from "./categories/debug.js";
import { registerDevCommands } from "./categories/dev.js";
import { registerApplyCommands } from "./categories/apply.js";

function isDirectCliExecution(): boolean {
  return process.argv[1] != null
    && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

export function createProgram(): Command {
  const program = new Command();
  registerApplyCommands(program);
  registerImportCommands(program);
  registerReportCommands(program);
  registerOpsCommands(program);
  // registerAnalyzeCommands: all analyze subcommands removed in 0.8.0; parent dropped.
  registerExplainCommands(program);
  registerDebugCommands(program);
  registerDevCommands(program);

  program
    .name("flaker")
    .description("Intelligent test selection — run fewer tests, catch more failures")
    .version("0.10.2")
    .showHelpAfterError()
    .showSuggestionAfterError();

  // Top-level aliases
  program
    .command("init")
    .description("Alias for `flaker setup init`")
    .option("--owner <owner>", "Repository owner (auto-detected from git remote)")
    .option("--name <name>", "Repository name (auto-detected from git remote)")
    .option("--adapter <type>", "Test result adapter: playwright|vitest|jest|junit")
    .option("--runner <type>", "Test runner: vitest|playwright|jest|actrun")
    .action(setupInitAction);

  program
    .command("run")
    .description("Run the selected gate or profile")
    .option("--gate <name>", "Gate name: iteration, merge, release")
    .option("--profile <name>", "Advanced: execution profile name such as scheduled, ci, local")
    .option("--strategy <s>", "Sampling strategy: random, weighted, affected, hybrid, gbdt, full")
    .option("--count <n>", "Number of tests to sample")
    .option("--percentage <n>", "Percentage of tests to sample")
    .option("--skip-quarantined", "Exclude quarantined tests")
    .option("--skip-flaky-tagged", "Exclude tests tagged with the configured flaky tag")
    .option("--changed <files>", "Comma-separated list of changed files (for affected/hybrid)")
    .option("--co-failure-days <days>", "Co-failure analysis window in days")
    .option("--cluster-mode <mode>", "Failure-cluster sampling mode: off, spread, pack")
    .option("--holdout-ratio <ratio>", "Fraction of skipped tests to run as holdout (0-1)")
    .option("--model-path <path>", "Path to GBDT model JSON")
    .option("--runner <runner>", "Runner type: direct or actrun", "direct")
    .option("--retry", "Retry failed tests (actrun only)")
    .option("--dry-run", "Select tests but do not execute them")
    .option("--explain", "Print per-test selection tier, score, and reason")
    .addHelpText("after", RUN_COMMAND_HELP)
    .action(execRunAction);

  program
    .command("status")
    .description("User-facing summary dashboard (summary-only, no promotion decision)")
    .option("--window-days <days>", "Analysis window in days", "30")
    .option("--json", "Output as JSON")
    .option("--markdown", "Render output as Markdown (mutually exclusive with --json)")
    .option("--list <mode>", "Standalone list mode: flaky | quarantined")
    .option("--detail", "Append per-threshold drift actuals after the summary")
    .option("--gate <name>", "Narrow the gates block to a single gate: iteration | merge | release")
    .action(statusAction);

  program
    .command("query <sql>")
    .description("Execute a read-only SQL query against the metrics database")
    .action(analyzeQueryAction);

  program
    .command("doctor")
    .description("Check runtime requirements")
    .action(debugDoctorAction);

  const originalHelpInformation = program.helpInformation.bind(program);
  program.helpInformation = () => {
    const base = originalHelpInformation();
    const extras = `
Getting started:
  flaker init                       Create flaker.toml (auto-detects repo)
  flaker doctor                     Check runtime requirements
  flaker run --gate iteration       Fast local feedback
  flaker run --gate merge           PR / mainline gate
  flaker status                     KPI dashboard (sampling, flaky, data quality)

Primary commands:
  init                                          Bootstrap flaker.toml
  plan                                          Preview actions apply would take
  apply                                         Reconcile repo to flaker.toml (idempotent)
  status                                        Dashboard + promotion drift
  run --gate <iteration|merge|release>          Execute the selected gate
  doctor                                        Verify local environment
  debug <retry|confirm|bisect|diagnose>         Incident investigation
  query <sql>                                   SQL escape hatch
  explain <topic>                               AI-assisted analysis
  import <file>                                 Ingest reports (adapter auto-detected)
  report <file> --summary|--diff|--aggregate    Local report shaping

Advanced:
  ops weekly|incident               Cadence artifact bundles
  (ops daily is deprecated in 0.9.0 — use \`flaker apply --emit daily\`)
  dev <train|tune|self-eval|...>    Maintainer tools

Run \`flaker <command> --help\` for details.
If you used legacy forms (collect*, analyze*, gate*, etc.) removed in
0.8.0, see docs/migration-0.6-to-0.7.md for the canonical replacements.
`;
    return base + extras;
  };

  return program;
}

const program = createProgram();

if (isDirectCliExecution()) {
  if (process.argv.length <= 2) {
    program.outputHelp();
    process.exit(0);
  }

  program.parseAsync(process.argv).catch((err) => {
    if (err instanceof Error) {
      if (err.message.includes("Config file not found") || err.message.includes("flaker.toml")) {
        console.error(`Error: ${err.message}`);
        console.error(`Run 'flaker init' to create one.`);
        process.exit(1);
      }
      if (err.message.includes("DuckDB") || err.message.includes("duckdb")) {
        console.error(`Error: ${err.message}`);
        console.error(`Run 'flaker doctor' to check your setup.`);
        process.exit(1);
      }
    }
    // Unknown error
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  });
}
