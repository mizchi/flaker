import { resolve } from "node:path";
import type { Command } from "commander";
import {
  loadConfig,
  resolveActrunWorkflowPath,
} from "../config.js";
import {
  formatSamplingSummary,
} from "../commands/exec/plan.js";
import { runTests, formatExplainTable } from "../commands/exec/run.js";
import { recordLocalRun } from "../commands/exec/record-local-run.js";
import { recordActrunRun } from "../commands/exec/record-actrun-run.js";
import {
  prepareRunRequest,
  type RunCliOpts,
} from "../commands/exec/prepare-run-request.js";
import {
  runAffected,
  formatAffectedReport,
} from "../commands/exec/affected.js";
import { ActrunRunner } from "../runners/actrun.js";
import { DuckDBStore } from "../storage/duckdb.js";
import { createRunner } from "../runners/index.js";
import { createResolver } from "../resolvers/index.js";
import { detectChangedFiles } from "../core/git.js";
import { loadQuarantineManifestIfExists } from "../quarantine-manifest.js";
import { runSamplingKpi } from "../commands/analyze/eval.js";
import { createConfiguredResolver } from "./shared-resolver.js";
import { executePreparedLocalRun } from "../commands/exec/execute-prepared-local-run.js";

type SamplingCliOpts = RunCliOpts;

function addSamplingOptions<T extends Command>(cmd: T): T {
  return cmd
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
    .option("--model-path <path>", "Path to GBDT model JSON") as T;
}

export const RUN_COMMAND_HELP = `
Gate names:
  iteration  -> profile.local      Fast local feedback for the author
  merge      -> profile.ci         PR / mainline gate
  release    -> profile.scheduled  Full or near-full verification

Use --gate for the normal workflow.
Use --profile only when you need an advanced or custom profile name.
`;

async function listRunnerTests(
  cwd: string,
  runnerConfig: {
    type: string;
    command: string;
    execute?: string;
    list?: string;
  },
) {
  try {
    const runner = createRunner(runnerConfig);
    return await runner.listTests({ cwd });
  } catch {
    return [];
  }
}

export async function execRunAction(rawOpts: SamplingCliOpts & { runner: string; retry?: boolean; dryRun?: boolean; explain?: boolean; json?: boolean }): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const store = new DuckDBStore(resolve(config.storage.path));
  await store.initialize();

  try {
    const prepared = await prepareRunRequest({
      cwd,
      config,
      store,
      opts: rawOpts,
      deps: {
        detectChangedFiles,
        loadQuarantineManifestIfExists,
        createResolver: createConfiguredResolver,
      },
    });

    if (prepared.gateName) {
      console.log(`# Gate: ${prepared.gateName} (profile: ${prepared.resolvedProfile.name})`);
    } else {
      console.log(`# Profile: ${prepared.resolvedProfile.name}`);
    }
    if (prepared.adaptiveReason) {
      console.log(`# Adaptive: ${prepared.adaptiveReason}`);
    }
    if (prepared.timeBudgetSeconds != null) {
      console.log(`# Time budget: ${prepared.timeBudgetSeconds}s`);
    }

    const opts = { ...prepared, runner: rawOpts.runner, retry: rawOpts.retry };
    if (opts.runner === "actrun") {
      const actRunner = new ActrunRunner({
        workflow: resolveActrunWorkflowPath(config),
        job: config.runner.actrun?.job,
        local: config.runner.actrun?.local,
        trust: config.runner.actrun?.trust,
      });
      if (opts.retry) {
        actRunner.retry();
      } else {
        const result = actRunner.runWithResult();
        await recordActrunRun({
          store,
          repoSlug: `${config.repo.owner}/${config.repo.name}`,
          result,
        });
        const { runEval, formatEvalReport } = await import("../commands/analyze/eval.js");
        const evalReport = await runEval({ store });
        console.log(formatEvalReport(evalReport));
      }
      return;
    }

    const kpi = await runSamplingKpi({ store });
    const execution = await executePreparedLocalRun({
      store,
      config,
      cwd,
      prepared: opts,
      dryRun: rawOpts.dryRun,
      explain: rawOpts.explain,
      runner: createRunner(config.runner),
    });
    const runResult = execution.runResult;
    console.log(formatSamplingSummary(runResult.samplingSummary, {
      ciPassWhenLocalPassRate: kpi.passSignal.rate,
    }));
    if (rawOpts.explain) {
      console.log(formatExplainTable(runResult.sampledTests, runResult.samplingSummary));
    }
    if (rawOpts.dryRun) {
      return;
    }
    if (runResult.exitCode !== 0) {
      process.exit(1);
    }
  } finally {
    await store.close();
  }
}

export function registerExecCommands(program: Command): void {
  const exec = program
    .command("exec")
    .description("Test selection and execution");

  addSamplingOptions(
    exec
      .command("run")
      .description("Run the selected gate or profile (auto-detects changed files and strategy from config)")
      .option("--runner <runner>", "Runner type: direct or actrun", "direct")
      .option("--retry", "Retry failed tests (actrun only)")
      .option("--dry-run", "Select tests but do not execute them")
      .option("--explain", "Print per-test selection tier, score, and reason"),
  )
    .addHelpText("after", RUN_COMMAND_HELP)
    .action(execRunAction);

  exec
    .command("affected [paths...]")
    .description("Explain affected test selection for changed files")
    .option("--changed <files>", "Comma-separated list of changed files")
    .option("--json", "Output JSON report")
    .option("--markdown", "Output Markdown report")
    .action(
      async (
        paths: string[],
        opts: { changed?: string; json?: boolean; markdown?: boolean },
      ) => {
        if (opts.json && opts.markdown) {
          console.error("Error: choose either --json or --markdown");
          process.exit(1);
        }

        const changedFiles = [
          ...paths,
          ...(opts.changed
            ? opts.changed
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean)
            : []),
        ];

        if (changedFiles.length === 0) {
          console.error("Error: at least one changed file is required");
          process.exit(1);
        }

        const cwd = process.cwd();
        const config = loadConfig(cwd);
        const resolver = createResolver(config.affected, cwd);
        const listedTests = await listRunnerTests(cwd, config.runner);
        const report = await runAffected({
          resolverName: config.affected.resolver,
          resolver,
          changedFiles,
          listedTests,
        });

        console.log(
          formatAffectedReport(report, opts.json ? "json" : "markdown"),
        );
      },
    );
}
