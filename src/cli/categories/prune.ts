import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { openDatasetStore } from "../datasets/open.js";
import { datasetSettingsFromConfig } from "../datasets/config-sync.js";
import { parsePositiveIntOption } from "../commands/exec/sampling-options.js";
import { formatPruneReport, runPrune } from "../commands/prune/prune.js";

export interface PruneCliOpts {
  olderThan: string;
  dryRun?: boolean;
  json?: boolean;
}

export async function pruneAction(opts: PruneCliOpts): Promise<void> {
  const olderThanDays = parsePositiveIntOption("--older-than", opts.olderThan);
  if (olderThanDays == null) {
    process.exitCode = 2;
    return;
  }
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const store = await openDatasetStore(cwd, config);
  try {
    const result = await runPrune({
      store,
      olderThanDays,
      settings: datasetSettingsFromConfig(config),
      dryRun: opts.dryRun ?? false,
    });
    console.log(opts.json ? JSON.stringify(result, null, 2) : formatPruneReport(result));
  } finally {
    await store.close();
  }
}

export function registerPruneCommand(program: Command): void {
  program
    .command("prune")
    .description("Delete history older than a number of days, then checkpoint the database")
    .requiredOption("--older-than <days>", "Remove runs, results, selector records, sampling runs and mutation trials older than this")
    .option("--dry-run", "Report what would be removed without deleting")
    .option("--json", "Print the result as JSON")
    .addHelpText(
      "after",
      `
Keeps quarantine, coverage, settings and each selector's latest gate
calibration. <days> must cover the flaky window on top of the longest
calibration / co-failure window (${"`"}max(90, [sampling].co_failure_window_days)
+ [flaky].window_days${"`"}, 104 by default), so no default window loses data.`,
    )
    .action(pruneAction);
}
