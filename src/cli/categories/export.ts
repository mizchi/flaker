import type { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadConfig, resolveSelectorConfig } from "../config.js";
import { FlakerUsageError } from "../errors.js";
import { openDatasetStore } from "../datasets/open.js";
import { DATASET_NAMES } from "../datasets/registry.js";
import { runExportDataset } from "../commands/export/dataset.js";
import { runProjection, PROJECTION_NAMES } from "../projections/index.js";

export interface ExportCliOpts {
  format: string;
  since?: string;
  where?: string;
  output?: string;
  projection?: string;
}

export async function exportAction(dataset: string | undefined, opts: ExportCliOpts): Promise<void> {
  const cwd = process.cwd();
  if (opts.projection !== undefined) {
    if (dataset) throw new FlakerUsageError("--projection does not take a dataset");
    if (opts.format !== "json") throw new FlakerUsageError("--projection writes JSON; drop --format");
    if (opts.since !== undefined || opts.where !== undefined) throw new FlakerUsageError("--since and --where apply to datasets, not projections");
    const config = loadConfig(cwd);
    const store = await openDatasetStore(cwd, config);
    try {
      const out = await runProjection(opts.projection, store, { selector: resolveSelectorConfig(config) });
      const text = `${JSON.stringify(out, null, 2)}\n`;
      if (opts.output) {
        const path = resolve(opts.output);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text, "utf8");
        process.stderr.write(`Wrote ${opts.projection} to ${opts.output}\n`);
      } else {
        process.stdout.write(text);
      }
    } finally {
      await store.close();
    }
    return;
  }
  if (!dataset) {
    throw new FlakerUsageError(`export needs a dataset: ${DATASET_NAMES.join(", ")}`);
  }
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
    .description("Write a public dataset (flaker_v1) or a projection")
    .argument("[dataset]", `Dataset: ${DATASET_NAMES.join(", ")}`)
    .option("--format <format>", "json | jsonl | csv | parquet", "json")
    .option("--since <date>", "Only rows at or after this date (datasets with a time column)")
    .option("--where <expr>", "Extra SQL condition over the dataset's columns")
    .option("-o, --output <file>", "Write to a file instead of stdout")
    .option("--projection <name>", `Emit a projection instead of a dataset: ${PROJECTION_NAMES.join(", ")}`)
    .action(exportAction);
}
