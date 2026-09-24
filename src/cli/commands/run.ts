import { resolve } from "node:path";
import {
  loadConfig,
  resolveActrunWorkflowPath,
} from "../config.js";
import {
  formatSamplingSummary,
} from "./exec/plan.js";
import { runTests, formatExplainTable } from "./exec/run.js";
import { recordLocalRun } from "./exec/record-local-run.js";
import { recordActrunRun } from "./exec/record-actrun-run.js";
import {
  prepareRunRequest,
  type RunCliOpts,
} from "./exec/prepare-run-request.js";
import { ActrunRunner } from "../runners/actrun.js";
import { DuckDBStore } from "../storage/duckdb.js";
import { createRunner } from "../runners/index.js";
import { loadQuarantineManifestIfExists } from "../quarantine-manifest.js";
import { detectChangedFiles } from "../core/git.js";
import { runSamplingKpi } from "./analyze/eval.js";
import { createConfiguredResolver } from "../categories/shared-resolver.js";
import { executePreparedLocalRun } from "./exec/execute-prepared-local-run.js";

type SamplingCliOpts = RunCliOpts;

export const RUN_COMMAND_HELP = `
Gate names:
  iteration  [gate.iteration]  Fast local feedback for the author
  merge      [gate.merge]      PR / mainline gate
  release    [gate.release]    Full or near-full verification

Without --gate, FLAKER_GATE is used; otherwise merge on CI, iteration elsewhere.
`;

export async function execRunAction(rawOpts: SamplingCliOpts & { runner: string; retry?: boolean; dryRun?: boolean; explain?: boolean; json?: boolean }): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const store = new DuckDBStore(resolve(config.storage.path));
  await store.initialize();

  try {
    const prepared = await prepareRunRequest({
      cwd,
      config,
      opts: rawOpts,
      deps: {
        detectChangedFiles,
        loadQuarantineManifestIfExists,
        createResolver: createConfiguredResolver,
      },
    });

    console.log(`# Gate: ${prepared.gateName}`);
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
        const { runEval, formatEvalReport } = await import("./analyze/eval.js");
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
