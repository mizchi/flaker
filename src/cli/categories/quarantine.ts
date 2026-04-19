import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Command } from "commander";
import { deprecate } from "../deprecation.js";
import { loadConfig } from "../config.js";
import { DuckDBStore } from "../storage/duckdb.js";
import {
  formatQuarantineSuggestionPlan,
  runQuarantineSuggest,
  type QuarantineSuggestionPlan,
} from "../commands/quarantine/suggest.js";
import {
  formatQuarantineApplyResult,
  runQuarantineApply,
} from "../commands/quarantine/apply.js";
import { createGhIssue, isGhAvailable } from "../gh.js";
import { buildQuarantineIssueOpts } from "../commands/policy/quarantine.js";

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

function readPlan(path: string): QuarantineSuggestionPlan {
  const target = resolve(process.cwd(), path);
  return JSON.parse(readFileSync(target, "utf8")) as QuarantineSuggestionPlan;
}

export async function quarantineApplyAction(
  opts: { from: string; createIssues?: boolean },
): Promise<void> {
  const config = loadConfig(process.cwd());
  const store = new DuckDBStore(resolve(config.storage.path));
  await store.initialize();
  try {
    const plan = readPlan(opts.from);
    const createIssue = opts.createIssues
      ? (input: {
        selector: { suite: string; testName: string };
        flakeRatePercentage: number;
        totalRuns: number;
        reason: string;
      }) => {
        if (!isGhAvailable()) {
          console.error("Warning: gh CLI not found. Skipping issue creation.");
          return null;
        }
        const issueOpts = buildQuarantineIssueOpts({
          suite: input.selector.suite,
          testName: input.selector.testName,
          flakyRate: input.flakeRatePercentage,
          totalRuns: input.totalRuns,
          reason: input.reason,
        });
        return createGhIssue({
          title: issueOpts.title,
          body: issueOpts.body,
          labels: issueOpts.labels,
          repo: `${config.repo.owner}/${config.repo.name}`,
        });
      }
      : undefined;

    const result = await runQuarantineApply({ store, plan, createIssue });
    console.log(formatQuarantineApplyResult(result));
  } finally {
    await store.close();
  }
}

export function registerQuarantineCommands(program: Command): void {
  const quarantine = program
    .command("quarantine")
    .description("Quarantine planning and plan-based mutation");

  const suggestCmd = quarantine
    .command("suggest")
    .description("Suggest quarantine add/remove actions without mutating state")
    .option("--window-days <days>", "Analysis window in days", "30")
    .option("--json", "Output as JSON")
    .option("--output <file>", "Write the rendered plan to a file")
    .action(quarantineSuggestAction);
  deprecate(suggestCmd, { since: "0.7.0", remove: "0.8.0", canonical: "flaker apply" });

  const applyCmd = quarantine
    .command("apply")
    .description("Apply a reviewed quarantine plan")
    .requiredOption("--from <file>", "Read plan JSON from a file")
    .option("--create-issues", "Create GitHub issues for newly quarantined tests")
    .action(quarantineApplyAction);
  deprecate(applyCmd, { since: "0.7.0", remove: "0.8.0", canonical: "flaker apply" });
}
