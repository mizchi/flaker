import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig, writeSamplingConfig } from "../config.js";
import { DuckDBStore } from "../storage/duckdb.js";
import { computeKpi } from "../commands/analyze/kpi.js";
import { planApply, type PlannedAction } from "../commands/apply/planner.js";
import { probeRepo } from "../commands/apply/probe.js";
import { runCollectCi } from "../commands/collect/ci.js";
import { runQuarantineSuggest } from "../commands/quarantine/suggest.js";
import { runQuarantineApply } from "../commands/quarantine/apply.js";
import { prepareRunRequest } from "../commands/exec/prepare-run-request.js";
import { executePreparedLocalRun } from "../commands/exec/execute-prepared-local-run.js";
import { createConfiguredResolver } from "./shared-resolver.js";
import { detectChangedFiles } from "../core/git.js";
import { loadQuarantineManifestIfExists } from "../quarantine-manifest.js";
import { executeDag } from "../commands/apply/dag.js";
import type { ExecutorDeps } from "../commands/apply/executor.js";
import {
  writeArtifact,
  serializePlanArtifact,
  serializeApplyArtifact,
  deserializePlanArtifact,
} from "../commands/apply/artifact.js";
import type { StateDiff } from "../commands/apply/state.js";

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

export function renderEmptyPlanHint(): string {
  return "hint: run `flaker status` to inspect current health.";
}

export function renderZeroTestHint(): string {
  return "hint: 0 tests discovered — check [runner].command and [affected].resolver";
}

export function isColdStartZeroTest(result: unknown): boolean {
  if (result == null || typeof result !== "object") return false;
  const r = result as Record<string, unknown>;
  const runResult = r["runResult"];
  if (runResult == null || typeof runResult !== "object") return false;
  const sampledTests = (runResult as Record<string, unknown>)["sampledTests"];
  return Array.isArray(sampledTests) && sampledTests.length === 0;
}

export async function planAction(opts: { json?: boolean; output?: string }): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const store = new DuckDBStore(resolve(config.storage.path));
  await store.initialize();
  try {
    const kpi = await computeKpi(store, { windowDays: 30 });
    const probe = await probeRepo({ cwd, store });
    const { diff, actions } = planApply({ config, kpi, probe });

    if (opts.output) {
      const artifact = serializePlanArtifact({
        generatedAt: new Date().toISOString(),
        diff,
        actions,
        probe,
      });
      writeArtifact(opts.output, artifact);
    }

    if (opts.json) {
      console.log(JSON.stringify({ actions }, null, 2));
      return;
    }
    if (actions.length === 0) {
      console.log("No actions needed. Current state matches flaker.toml.");
      process.stderr.write(renderEmptyPlanHint() + "\n");
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

function newDriftKinds(current: StateDiff, planned: StateDiff): string[] {
  const plannedKinds = new Set(planned.drifts.map((d) => d.kind));
  return current.drifts
    .filter((d) => !plannedKinds.has(d.kind))
    .map((d) => d.kind);
}

export async function applyAction(opts: {
  json?: boolean;
  output?: string;
  refreshOnly?: boolean;
  planFile?: string;
  force?: boolean;
}): Promise<void> {
  // Mutual exclusion: --refresh-only and --plan-file
  if (opts.refreshOnly && opts.planFile) {
    console.error("Error: --refresh-only and --plan-file are mutually exclusive.");
    process.exitCode = 2;
    return;
  }

  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const store = new DuckDBStore(resolve(config.storage.path));
  await store.initialize();
  try {
    const kpi = await computeKpi(store, { windowDays: 30 });
    const probe = await probeRepo({ cwd, store });
    const { diff, actions } = planApply({ config, kpi, probe });

    // --refresh-only: print plan and optionally write PlanArtifact, then exit without executing
    if (opts.refreshOnly) {
      if (opts.output) {
        const artifact = serializePlanArtifact({
          generatedAt: new Date().toISOString(),
          diff,
          actions,
          probe,
        });
        writeArtifact(opts.output, artifact);
      }
      if (opts.json) {
        console.log(JSON.stringify({ actions }, null, 2));
        return;
      }
      if (actions.length === 0) {
        console.log("No actions needed. Current state matches flaker.toml.");
        process.stderr.write(renderEmptyPlanHint() + "\n");
        return;
      }
      console.log("Planned actions:");
      for (const action of actions) {
        console.log(`  - ${describeAction(action)}`);
      }
      return;
    }

    const deps: ExecutorDeps = {
      collectCi: async ({ windowDays }) =>
        runCollectCi({ store, config, cwd, days: windowDays }),
      calibrate: async () => {
        const { calibrateSampling } = await import("../commands/collect/calibrate.js");
        const { sampling } = await calibrateSampling(store, config, { windowDays: 90 });
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

    // --plan-file: load saved plan, check for new drift, execute stored actions
    if (opts.planFile) {
      let content: string;
      try {
        content = readFileSync(opts.planFile, "utf8");
      } catch {
        console.error(`Error: cannot read plan file: ${opts.planFile}`);
        process.exitCode = 2;
        return;
      }
      const planned = deserializePlanArtifact(content);
      const newKinds = newDriftKinds(diff, planned.diff);
      if (newKinds.length > 0) {
        process.stderr.write(
          `Warning: new drift detected since plan was saved: ${newKinds.join(", ")}\n`,
        );
        if (!opts.force) {
          console.error("Error: repo state has drifted from plan. Use --force to apply anyway.");
          process.exitCode = 2;
          return;
        }
      }
      const planDagResult = await executeDag(planned.actions, deps);
      if (!opts.json) {
        for (const exec of planDagResult.executed) {
          const mark =
            exec.status === "ok"      ? "ok  " :
            exec.status === "failed"  ? "fail" :
                                        "skip";
          const suffix =
            exec.status === "failed"  ? ` — ${exec.error ?? ""}` :
            exec.status === "skipped" ? ` — ${exec.skippedReason ?? ""}` :
                                        "";
          console.log(`${mark} ${exec.kind}${suffix}`);
        }
        if (planDagResult.executed.some((e) => e.status === "failed")) {
          process.exitCode = 1;
        }
      } else {
        console.log(JSON.stringify({ executed: planDagResult.executed }, null, 2));
      }
      return;
    }

    if (actions.length === 0) {
      console.log("No actions needed. Current state matches flaker.toml.");
      if (!opts.json) {
        process.stderr.write(renderEmptyPlanHint() + "\n");
      }
      return;
    }

    const dagResult = await executeDag(actions, deps);
    const result = { executed: dagResult.executed };

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const exec of result.executed) {
        const mark =
          exec.status === "ok"      ? "ok  " :
          exec.status === "failed"  ? "fail" :
                                      "skip";
        const suffix =
          exec.status === "failed"  ? ` — ${exec.error ?? ""}` :
          exec.status === "skipped" ? ` — ${exec.skippedReason ?? ""}` :
                                      "";
        console.log(`${mark} ${exec.kind}${suffix}`);
        if (exec.status === "ok" && exec.kind === "cold_start_run" && isColdStartZeroTest(exec.result)) {
          process.stderr.write(renderZeroTestHint() + "\n");
        }
      }

      if (result.executed.some((e) => e.status === "failed")) {
        process.exitCode = 1;
      }
    }

    if (opts.output) {
      const artifact = serializeApplyArtifact({
        generatedAt: new Date().toISOString(),
        diff,
        actions,
        executed: result.executed,
        probe,
      });
      writeArtifact(opts.output, artifact);
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
    .option("--output <file>", "Write PlanArtifact JSON to a file")
    .action(planAction);

  program
    .command("apply")
    .description("Apply planned actions to converge the repo state to flaker.toml")
    .option("--json", "Output as JSON")
    .option("--output <file>", "Write ApplyArtifact JSON to a file")
    .option("--refresh-only", "Run probe + state-diff + plan but skip execution (writes PlanArtifact if --output set)")
    .option("--plan-file <file>", "Load a previously-saved PlanArtifact and execute its stored actions")
    .option("--force", "Force execution even if repo state has drifted from the plan file")
    .action(applyAction);
}
