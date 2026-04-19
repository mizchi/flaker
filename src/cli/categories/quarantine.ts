import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { DuckDBStore } from "../storage/duckdb.js";
import {
  formatQuarantineSuggestionPlan,
  runQuarantineSuggest,
} from "../commands/quarantine/suggest.js";

function writeOutput(path: string, content: string): void {
  const target = resolve(process.cwd(), path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

export async function quarantineSuggestAction(
  opts: { windowDays: string; json?: boolean; output?: string },
): Promise<void> {
  const config = loadConfig(process.cwd());
  const store = new DuckDBStore(resolve(config.storage.path));
  await store.initialize();
  try {
    const plan = await runQuarantineSuggest({
      store,
      windowDays: parseInt(opts.windowDays, 10),
      flakyRateThresholdPercentage: config.quarantine.flaky_rate_threshold_percentage,
      minRuns: config.quarantine.min_runs,
    });
    const rendered = opts.json
      ? JSON.stringify(plan, null, 2)
      : formatQuarantineSuggestionPlan(plan);
    if (opts.output) {
      writeOutput(opts.output, rendered);
    }
    console.log(rendered);
  } finally {
    await store.close();
  }
}

export function registerQuarantineCommands(program: Command): void {
  const quarantine = program
    .command("quarantine")
    .description("Read-only quarantine planning and inspection");

  quarantine
    .command("suggest")
    .description("Suggest quarantine add/remove actions without mutating state")
    .option("--window-days <days>", "Analysis window in days", "30")
    .option("--json", "Output as JSON")
    .option("--output <file>", "Write the rendered plan to a file")
    .action(quarantineSuggestAction);
}
