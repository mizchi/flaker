import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { FlakerUsageError } from "../errors.js";
import { openDatasetStore } from "../datasets/open.js";
import { DATASET_NAMES } from "../datasets/registry.js";
import { runExportDataset } from "../commands/export/dataset.js";

export interface ExportCliOpts {
  format: string;
  since?: string;
  where?: string;
  output?: string;
}

export async function exportAction(dataset: string | undefined, opts: ExportCliOpts): Promise<void> {
  if (!dataset) {
    throw new FlakerUsageError(`export needs a dataset: ${DATASET_NAMES.join(", ")}`);
  }
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const store = await openDatasetStore(cwd, config);
  try {
    const { rows, text } = await runExportDataset({ store, dataset, ...opts });
    if (text !== null) process.stdout.write(text);
    else process.stderr.write(`Wrote ${rows} rows of flaker_v1.${dataset} to ${opts.output}\n`);
  } finally {
    await store.close();
  }
}

export function registerExportCommand(program: Command): void {
  program
    .command("export")
    .description("Write a public dataset (flaker_v1)")
    .argument("[dataset]", `Dataset: ${DATASET_NAMES.join(", ")}`)
    .option("--format <format>", "json | jsonl | csv | parquet", "json")
    .option("--since <date>", "Only rows at or after this date (datasets with a time column)")
    .option("--where <expr>", "Extra SQL condition over the dataset's columns")
    .option("-o, --output <file>", "Write to a file instead of stdout")
    .action(exportAction);
}
