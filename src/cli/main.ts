#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, type HelpContext } from "commander";
import { registerSetupCommands, setupInitAction } from "./categories/setup.js";
import { registerExecCommands, execRunAction, RUN_COMMAND_HELP } from "./categories/exec.js";
import { registerCollectCommands } from "./categories/collect.js";
import { registerImportCommands } from "./categories/import.js";
import { registerReportCommands } from "./categories/report.js";
import { registerAnalyzeCommands, analyzeKpiAction, statusAction } from "./categories/analyze.js";
import { registerGateCommands } from "./categories/gate.js";
import { registerOpsCommands } from "./categories/ops.js";
import { registerQuarantineCommands } from "./categories/quarantine.js";
import { registerDebugCommands, debugDoctorAction } from "./categories/debug.js";
import { registerPolicyCommands } from "./categories/policy.js";
import { registerDevCommands } from "./categories/dev.js";
import { registerApplyCommands } from "./categories/apply.js";

function warnDeprecated(aliasName: string, canonical: string): void {
  process.stderr.write(
    `warning: \`flaker ${aliasName}\` is deprecated and will be removed in 0.7.0. `
    + `Use \`${canonical}\` instead.\n`,
  );
}

function attachDeprecationWarning(cmd: Command, aliasName: string, canonical: string): void {
  const origOutputHelp = cmd.outputHelp.bind(cmd);
  const wrapped = (context?: HelpContext) => {
    warnDeprecated(aliasName, canonical);
    return origOutputHelp(context);
  };
  // Commander's outputHelp has overloads; cast to satisfy the assignment
  cmd.outputHelp = wrapped as typeof cmd.outputHelp;
}

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
  registerDebugCommands(program);
  registerPolicyCommands(program);
  registerDevCommands(program);

  program
    .name("flaker")
    .description("Intelligent test selection — run fewer tests, catch more failures")
    .version("0.5.0")
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
    .description("DEPRECATED alias for `flaker analyze kpi` (removed in 0.7.0)")
    .option("--window-days <days>", "Analysis window in days", "30")
    .option("--json", "Output as JSON")
    .action((opts) => {
      warnDeprecated("kpi", "flaker analyze kpi");
      return analyzeKpiAction(opts);
    });
  attachDeprecationWarning(kpiCmd, "kpi", "flaker analyze kpi");

  program
    .command("status")
    .description("User-facing summary dashboard (summary-only, no promotion decision)")
    .option("--window-days <days>", "Analysis window in days", "30")
    .option("--json", "Output as JSON")
    .action(statusAction);

  const doctorCmd = program
    .command("doctor")
    .description("DEPRECATED alias for `flaker debug doctor` (removed in 0.7.0)")
    .action(() => {
      warnDeprecated("doctor", "flaker debug doctor");
      return debugDoctorAction();
    });
  attachDeprecationWarning(doctorCmd, "doctor", "flaker debug doctor");

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
  gate        Review gate readiness and sampling health
  ops         Generate operator review artifacts
  quarantine  Suggest quarantine add/remove plans

Gate model:
  iteration   -> profile.local      Fast author feedback
  merge       -> profile.ci         PR / mainline gate
  release     -> profile.scheduled  Full or near-full verification

Run \`flaker run --help\` for gate mapping and advanced run options.
Run \`flaker status --help\` or \`flaker doctor --help\` for user-facing commands.

Management and advanced categories:
  gate       Gate review and readiness        (review)
  ops        Operator cadence artifacts       (weekly)
  quarantine Read-only quarantine planning    (suggest)
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
