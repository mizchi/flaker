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
import { jevSelector, runMutationTrials, type MutationTrialsResult } from "../commands/calibrate/mutate.js";
import { createRunner } from "../runners/index.js";
import type { FlakerConfig } from "../config.js";
import type { TestCaseResult } from "../adapters/types.js";

export interface CalibrateCliOpts {
  windowDays: string;
  dryRun?: boolean;
  json?: boolean;
  /** true for a bare `--selector`, the name for `--selector <name>`. */
  selector?: string | boolean;
  mutate?: string;
  seed: string;
  commits: string;
  setup?: string;
  selectorCommand: string;
}

/** The whole suite through [runner]: list every test, then run them all. */
function fullSuite(config: FlakerConfig): (cwd: string) => Promise<TestCaseResult[]> {
  const runner = createRunner(config.runner);
  return async (cwd) => {
    const tests = await runner.listTests({ cwd });
    return (await runner.execute(tests, { cwd })).results;
  };
}

function formatMutationTrials(r: MutationTrialsResult): string {
  const lines = [
    `Mutation trials on ${r.base_sha.slice(0, 12)} (${r.candidate_files} candidate files)`,
  ];
  if (r.baseline) lines.push(`  baseline: ${r.baseline.tests} tests, ${r.baseline.failures} failing (not counted as kills)`);
  for (const t of r.trials) {
    lines.push(`  ${t.mutation}`);
    lines.push(t.skipped ? `    skipped: ${t.skipped}` : `    killed ${t.killed} of ${t.tests} tests; record ${t.selector_run_id}`);
  }
  return lines.join("\n");
}

export async function calibrateAction(opts: CalibrateCliOpts): Promise<void> {
  if (opts.selector !== undefined || opts.mutate !== undefined) {
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
  let mutate: { count: number; seed: number; commits: number } | null = null;
  if (opts.mutate !== undefined) {
    const count = parsePositiveIntOption("--mutate", opts.mutate);
    const seed = Number.isInteger(Number(opts.seed)) ? Number(opts.seed) : null;
    const commits = parsePositiveIntOption("--commits", opts.commits);
    if (count == null || commits == null || seed == null) {
      if (seed == null) console.error(`Invalid --seed value: ${opts.seed}. Expected an integer.`);
      process.exitCode = 2;
      return;
    }
    mutate = { count, seed, commits };
  }
  const store = await openDatasetStore(cwd, config);
  try {
    let trials: MutationTrialsResult | null = null;
    if (mutate) {
      trials = await runMutationTrials({
        store, cwd, selector, ...mutate,
        setup: opts.setup,
        dryRun: opts.dryRun === true,
        deps: { runSuite: fullSuite(config), runSelector: jevSelector(opts.selectorCommand) },
        log: (line) => process.stderr.write(`${line}\n`),
      });
      if (!opts.json) console.log(formatMutationTrials(trials));
    }
    const result = await runSelectorCalibration({ store, selector, windowDays, dryRun: opts.dryRun === true });
    if (opts.json) {
      console.log(JSON.stringify(snakeKeys({
        ...(trials ? { mutationTrials: trials } : {}),
        selector: result.selector,
        calibratedAt: result.calibratedAt,
        decision: result.decision,
        withoutFullRun: result.withoutFullRun,
        superseded: result.superseded,
        unmatched: result.unmatched,
        mutation: result.mutation,
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
    .option("--mutate <n>", "With the selector: first run n mutation trials in a temporary worktree (full suite + selector per mutation); their misses can only tighten the gate")
    .option("--seed <n>", "With --mutate: seed for picking mutations", "1")
    .option("--commits <n>", "With --mutate: mutate source files changed in this many recent commits", "20")
    .option("--setup <cmd>", "With --mutate: shell command run once in the worktree before the baseline (e.g. a build)")
    .option("--selector-command <cmd>", "With --mutate: the selector executable, run with --base --context --json", "jev-test-filter")
    .option("--dry-run", "Report without writing flaker.toml or gate_calibration; with --mutate, list the mutations without running them")
    .option("--json", "Output as JSON")
    .action(calibrateAction);
}
