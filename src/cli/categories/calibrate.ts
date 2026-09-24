import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig, resolveSelectorConfig, writeSamplingConfig } from "../config.js";
import { DuckDBStore } from "../storage/duckdb.js";
import {
  calibrateSampling,
  formatCalibrationReport,
} from "../commands/collect/calibrate.js";
import { parsePositiveIntOption } from "../commands/exec/sampling-options.js";
import { FlakerUsageError } from "../errors.js";
import { openDatasetStore } from "../datasets/open.js";
import { formatSelectorCalibration, runSelectorCalibration } from "../commands/calibrate/selector.js";

export interface CalibrateCliOpts {
  windowDays: string;
  dryRun?: boolean;
  json?: boolean;
  /** true for a bare `--selector`, the name for `--selector <name>`. */
  selector?: string | boolean;
}

export async function calibrateAction(opts: CalibrateCliOpts): Promise<void> {
  if (opts.selector !== undefined) {
    await selectorCalibrateAction(opts);
    return;
  }
  const windowDays = parsePositiveIntOption("--window-days", opts.windowDays);
  if (windowDays == null) {
    process.exitCode = 2;
    return;
  }

  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const store = new DuckDBStore(resolve(cwd, config.storage.path));
  await store.initialize();
  try {
    const { profile, sampling } = await calibrateSampling(store, config, { windowDays });
    const written = !opts.dryRun;
    if (written) writeSamplingConfig(cwd, sampling);
    if (opts.json) {
      console.log(JSON.stringify({ profile, sampling, written }, null, 2));
    } else {
      console.log(formatCalibrationReport({ profile, sampling }));
      console.log(written ? "Wrote [sampling] to flaker.toml." : "Dry run: flaker.toml was not changed.");
    }
  } finally {
    await store.close();
  }
}

async function selectorCalibrateAction(opts: CalibrateCliOpts): Promise<void> {
  const windowDays = parsePositiveIntOption("--window-days", opts.windowDays);
  if (windowDays == null) {
    process.exitCode = 2;
    return;
  }
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const selector = resolveSelectorConfig(config);
  if (typeof opts.selector === "string" && opts.selector !== selector.type) {
    throw new FlakerUsageError(`unknown selector "${opts.selector}"; configured selector is "${selector.type}"`);
  }
  const store = await openDatasetStore(cwd, config);
  try {
    const result = await runSelectorCalibration({ store, selector, windowDays, dryRun: opts.dryRun === true });
    if (opts.json) {
      console.log(JSON.stringify(snakeKeys({
        selector: result.selector,
        calibratedAt: result.calibratedAt,
        decision: result.decision,
        withoutFullRun: result.withoutFullRun,
        superseded: result.superseded,
        unmatched: result.unmatched,
        written: result.written,
      }), null, 2));
    } else {
      console.log(formatSelectorCalibration(result));
    }
  } finally {
    await store.close();
  }
}

/** The JSON output uses snake_case keys throughout, like the flaker_v1 datasets. */
function snakeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [
    key.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase()),
    snakeKeys(v),
  ]));
}

export function registerCalibrateCommand(program: Command): void {
  program
    .command("calibrate")
    .description("Recommend [sampling] from history and write it to flaker.toml; with --selector, calibrate the selector gate")
    .option("--window-days <days>", "Analysis window in days", "90")
    .option("--selector [name]", "Calibrate the selector's gate (jev) from its records and full runs; appends to gate_calibration")
    .option("--dry-run", "Report without writing flaker.toml or gate_calibration")
    .option("--json", "Output as JSON")
    .action(calibrateAction);
}
