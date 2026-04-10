#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerSetupCommands } from "./categories/setup.js";
import { registerExecCommands } from "./categories/exec.js";
import { registerCollectCommands } from "./categories/collect.js";
import { registerImportCommands } from "./categories/import.js";
import { registerReportCommands } from "./categories/report.js";
import { registerAnalyzeCommands } from "./categories/analyze.js";
import { registerDebugCommands } from "./categories/debug.js";
import { registerPolicyCommands } from "./categories/policy.js";
import { registerDevCommands } from "./categories/dev.js";

function appendHelpText<T extends Command>(
  command: T,
  extra: string,
): T {
  const originalHelpInformation = command.helpInformation.bind(command);
  command.helpInformation = () => `${originalHelpInformation()}${extra}`;
  return command;
}

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
    .version("0.1.0")
    .showHelpAfterError()
    .showSuggestionAfterError();

  appendHelpText(
    program,
    "\nGetting started (3 commands):\n" +
    "  flaker init                  Set up flaker.toml (auto-detects repo from git)\n" +
    "  flaker calibrate             Analyze history, write optimal sampling config\n" +
    "  flaker exec run              Select and execute tests (uses calibrated config)\n" +
    "\n" +
    "Building history:\n" +
    "  flaker collect --last 30     Import CI runs from GitHub Actions\n" +
    "  flaker collect-local         Import local actrun history\n" +
    "\n" +
    "Analysis:\n" +
    "  flaker kpi                   KPI dashboard (sampling, flaky, data quality)\n" +
    "  flaker flaky                 Show flaky test rankings\n" +
    "  flaker insights              Compare CI vs local failure patterns\n" +
    "  flaker eval                  Detailed evaluation report\n" +
    "\n" +
    "Advanced:\n" +
    "  flaker train                 Train GBDT model for ML-based selection\n" +
    "  flaker eval-fixture          Benchmark strategies with synthetic data\n" +
    "  flaker doctor                Check runtime requirements\n",
  );

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
