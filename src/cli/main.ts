#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerSetupCommands, setupInitAction } from "./categories/setup.js";
import { registerExecCommands, execRunAction, RUN_COMMAND_HELP } from "./categories/exec.js";
import { registerCollectCommands } from "./categories/collect.js";
import { registerImportCommands } from "./categories/import.js";
import { registerReportCommands } from "./categories/report.js";
import { registerAnalyzeCommands, analyzeKpiAction } from "./categories/analyze.js";
import { registerDebugCommands, debugDoctorAction } from "./categories/debug.js";
import { registerPolicyCommands } from "./categories/policy.js";
import { registerDevCommands } from "./categories/dev.js";

function isDirectCliExecution(): boolean {
  return process.argv[1] != null
    && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

export function createProgram(): Command {
  const program = new Command();
  registerSetupCommands(program);
  registerExecCommands(program);
  registerCollectCommands(program);
  registerImportCommands(program);
  registerReportCommands(program);
  registerAnalyzeCommands(program);
  registerDebugCommands(program);
  registerPolicyCommands(program);
  registerDevCommands(program);

  program
    .name("flaker")
    .description("Intelligent test selection — run fewer tests, catch more failures")
    .version("0.4.0")
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
    .command("kpi")
    .description("Alias for `flaker analyze kpi`")
    .option("--window-days <days>", "Analysis window in days", "30")
    .option("--json", "Output as JSON")
    .action(analyzeKpiAction);

  program
    .command("status")
    .description("User-facing status dashboard (alias for `flaker analyze kpi`)")
    .option("--window-days <days>", "Analysis window in days", "30")
    .option("--json", "Output as JSON")
    .action(analyzeKpiAction);

  program
    .command("doctor")
    .description("User-facing environment check (alias for `flaker debug doctor`)")
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
  init        Create flaker.toml and bootstrap config
  run         Run the selected gate or profile
  status      Show the user-facing health dashboard
  doctor      Check local runtime requirements

Gate model:
  iteration   -> profile.local      Fast author feedback
  merge       -> profile.ci         PR / mainline gate
  release     -> profile.scheduled  Full or near-full verification

Run \`flaker run --help\` for gate mapping and advanced run options.
Run \`flaker status --help\` or \`flaker doctor --help\` for user-facing commands.

Management and advanced categories:
  collect    Import history and calibration (ci, local, coverage, commit-changes, calibrate)
  import     Ingest external reports        (report, parquet)
  report     Normalize and diff reports     (summary, diff, aggregate)
  analyze    Read-only inspection           (bundle, kpi, flaky, reason, insights, eval, context, query)
  debug      Active investigation           (diagnose, bisect, confirm, retry, doctor)
  policy     Enforcement and ownership      (quarantine, check)
  dev        Model training and benchmarks  (train, tune, self-eval, eval-fixture, eval-co-failure, test-key)

Compatibility and internal categories remain available:
  setup      Project scaffolding            (init)
  exec       Test selection and execution   (run, affected)

Run \`flaker <category> --help\` for the full list under each category.
Run \`flaker <category> <command> --help\` for per-command options.
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
