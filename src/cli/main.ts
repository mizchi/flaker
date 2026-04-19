#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerSetupCommands, setupInitAction } from "./categories/setup.js";
import { registerExecCommands, execRunAction, RUN_COMMAND_HELP } from "./categories/exec.js";
import { registerCollectCommands } from "./categories/collect.js";
import { registerImportCommands } from "./categories/import.js";
import { registerReportCommands } from "./categories/report.js";
import { registerAnalyzeCommands, analyzeKpiAction, statusAction, analyzeQueryAction } from "./categories/analyze.js";
import { registerExplainCommands } from "./categories/explain.js";
import { registerGateCommands } from "./categories/gate.js";
import { registerOpsCommands } from "./categories/ops.js";
import { registerQuarantineCommands } from "./categories/quarantine.js";
import { registerDebugCommands, debugDoctorAction } from "./categories/debug.js";
import { registerPolicyCommands } from "./categories/policy.js";
import { registerDevCommands } from "./categories/dev.js";
import { registerApplyCommands } from "./categories/apply.js";
import { deprecate } from "./deprecation.js";

function isDirectCliExecution(): boolean {
  return process.argv[1] != null
    && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

export function createProgram(): Command {
  const program = new Command();
  registerSetupCommands(program);
  registerApplyCommands(program);
  registerExecCommands(program);
  registerCollectCommands(program);
  registerImportCommands(program);
  registerReportCommands(program);
  registerGateCommands(program);
  registerOpsCommands(program);
  registerQuarantineCommands(program);
  registerAnalyzeCommands(program);
  registerExplainCommands(program);
  registerDebugCommands(program);
  registerPolicyCommands(program);
  registerDevCommands(program);

  program
    .name("flaker")
    .description("Intelligent test selection — run fewer tests, catch more failures")
    .version("0.7.1")
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

  const kpiCmd = program
    .command("kpi")
    .description("KPI dashboard (sampling effectiveness, flaky, data quality)")
    .option("--window-days <days>", "Analysis window in days", "30")
    .option("--json", "Output as JSON")
    .action(analyzeKpiAction);
  deprecate(kpiCmd, { since: "0.7.0", remove: "0.8.0", canonical: "flaker analyze kpi" });

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
  gate review <name>                Authoritative promotion metrics (--json)
  ops daily|weekly|incident         Cadence artifact bundles
  analyze query                     (legacy — use \`flaker query\`)
  dev <train|tune|self-eval|...>    Maintainer tools

Deprecated (removed in 0.8.0):
  setup init                        → flaker init
  exec run / exec affected          → flaker run
  collect ci|local|coverage|calibrate → flaker apply
  quarantine suggest|apply          → flaker apply
  policy quarantine|check|report    → flaker apply
  analyze kpi|eval|flaky|flaky-tag  → flaker status (see --list, --markdown)
  analyze reason|insights|cluster|bundle|context → flaker explain <topic>
  analyze query                     → flaker query
  import report|parquet             → flaker import <file>
  report summary|diff|aggregate     → flaker report <file> --summary|--diff|--aggregate
  debug doctor                      → flaker doctor
  gate review|history|explain       → flaker status --gate <name> [--detail]
  kpi                               → flaker analyze kpi (also deprecated)

Run \`flaker <command> --help\` for details.
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
