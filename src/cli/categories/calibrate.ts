import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig, writeSamplingConfig } from "../config.js";
import { DuckDBStore } from "../storage/duckdb.js";
import {
  analyzeProject,
  formatCalibrationReport,
  recommendSampling,
} from "../commands/collect/calibrate.js";

export interface CalibrateCliOpts {
  windowDays: string;
  dryRun?: boolean;
  json?: boolean;
}

export async function calibrateAction(opts: CalibrateCliOpts): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const store = new DuckDBStore(resolve(cwd, config.storage.path));
  await store.initialize();
  try {
    const hasResolver = config.affected.resolver !== "" && config.affected.resolver !== "none";
    const profile = await analyzeProject(store, {
      hasResolver,
      windowDays: Number(opts.windowDays),
    });
    const sampling = recommendSampling(profile);
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

export function registerCalibrateCommand(program: Command): void {
  program
    .command("calibrate")
    .description("Recommend [sampling] from history and write it to flaker.toml")
    .option("--window-days <days>", "Analysis window in days", "90")
    .option("--dry-run", "Report the recommendation without writing flaker.toml")
    .option("--json", "Output as JSON")
    .action(calibrateAction);
}
