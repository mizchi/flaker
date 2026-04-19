import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig, writeSamplingConfig } from "../config.js";
import { DuckDBStore } from "../storage/duckdb.js";
import { computeKpi } from "../commands/analyze/kpi.js";
import { planApply, type PlannedAction, type RepoProbe } from "../commands/apply/planner.js";
import { collectCiAction } from "./collect.js";
import { runQuarantineSuggest } from "../commands/quarantine/suggest.js";
import { runQuarantineApply } from "../commands/quarantine/apply.js";
import { prepareRunRequest } from "../commands/exec/prepare-run-request.js";
import { executePreparedLocalRun } from "../commands/exec/execute-prepared-local-run.js";
import { createConfiguredResolver } from "./shared-resolver.js";
import { detectChangedFiles } from "../core/git.js";
import { loadQuarantineManifestIfExists } from "../quarantine-manifest.js";
import { executePlan, type ExecutorDeps } from "../commands/apply/executor.js";

function describeAction(action: PlannedAction): string {
  switch (action.kind) {
    case "collect_ci":
      return `collect_ci --days ${action.windowDays}    (${action.reason})`;
    case "calibrate":
      return `calibrate                    (${action.reason})`;
    case "cold_start_run":
      return `run --gate iteration         (${action.reason})`;
    case "quarantine_apply":
      return `quarantine apply             (${action.reason})`;
  }
}

function probeRepo(cwd: string): RepoProbe {
  return {
    hasGitRemote: existsSync(resolve(cwd, ".git")),
    hasGithubToken: Boolean(process.env.GITHUB_TOKEN),
    hasLocalHistory: false,
  };
}

export async function planAction(opts: { json?: boolean }): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const store = new DuckDBStore(resolve(config.storage.path));
  await store.initialize();
  try {
    const kpi = await computeKpi(store, { windowDays: 30 });
    const probe = probeRepo(cwd);
    const actions = planApply({ config, kpi, probe });
    if (opts.json) {
      console.log(JSON.stringify({ actions }, null, 2));
      return;
    }
    if (actions.length === 0) {
      console.log("No actions needed. Current state matches flaker.toml.");
      return;
    }
    console.log("Planned actions:");
    for (const action of actions) {
      console.log(`  - ${describeAction(action)}`);
    }
  } finally {
    await store.close();
  }
}

export async function applyAction(opts: { json?: boolean }): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const store = new DuckDBStore(resolve(config.storage.path));
  await store.initialize();
  try {
    const kpi = await computeKpi(store, { windowDays: 30 });
    const probe = probeRepo(cwd);
    const actions = planApply({ config, kpi, probe });

    const deps: ExecutorDeps = {
      collectCi: async ({ windowDays }) =>
        collectCiAction({ days: String(windowDays) }),
      calibrate: async () => {
        const { analyzeProject, recommendSampling } = await import(
          "../commands/collect/calibrate.js"
        );
        const hasResolver =
          config.affected.resolver !== "" && config.affected.resolver !== "none";
        const hasGBDTModel = existsSync(resolve(".flaker", "models", "gbdt.json"));
        const profile = await analyzeProject(store, {
          hasResolver,
          hasGBDTModel,
          windowDays: 90,
        });
        const sampling = recommendSampling(profile);
        writeSamplingConfig(cwd, sampling);
        return { sampling };
      },
      coldStartRun: async () => {
        const prepared = await prepareRunRequest({
          cwd,
          config,
          store,
          opts: { gate: "iteration" },
          deps: {
            detectChangedFiles,
            loadQuarantineManifestIfExists,
            createResolver: createConfiguredResolver,
          },
        });
        return executePreparedLocalRun({ store, config, cwd, prepared });
      },
      quarantineApply: async () => {
        const plan = await runQuarantineSuggest({ store });
        return runQuarantineApply({ store, plan });
      },
    };

    const result = await executePlan(actions, deps);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const exec of result.executed) {
        const mark = exec.ok ? "ok  " : "fail";
        console.log(`${mark} ${exec.kind}${exec.error ? ` — ${exec.error}` : ""}`);
      }
      if (result.aborted) {
        process.exitCode = 1;
      }
    }
  } finally {
    await store.close();
  }
}

export function registerApplyCommands(program: Command): void {
  program
    .command("plan")
    .description("Preview actions `flaker apply` would take for the current repo state")
    .option("--json", "Output as JSON")
    .action(planAction);

  program
    .command("apply")
    .description("Apply planned actions to converge the repo state to flaker.toml")
    .option("--json", "Output as JSON")
    .action(applyAction);
}
