import { existsSync } from "node:fs";
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
  type EmitKind,
  type EmittedArtifact,
} from "../commands/apply/artifact.js";
import { runOpsDaily, formatOpsDailyReport } from "../commands/ops/daily.js";
import { runOpsWeekly, formatOpsWeeklyReport } from "../commands/ops/weekly.js";
import { createRunner } from "../runners/index.js";

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

const VALID_EMIT_KINDS = ["daily", "weekly", "incident"] as const;

export async function applyAction(opts: {
  json?: boolean;
  output?: string;
  emit?: string;
}): Promise<void> {
  // Validate --emit value early
  if (opts.emit !== undefined && !(VALID_EMIT_KINDS as readonly string[]).includes(opts.emit)) {
    console.error(`Error: --emit must be one of: ${VALID_EMIT_KINDS.join(", ")}`);
    process.exitCode = 2;
    return;
  }
  if (opts.emit === "incident") {
    console.error(
      "Error: --emit incident requires --incident-* args (coming in 1.0.0). Use `flaker ops incident` for now.",
    );
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

    const deps: ExecutorDeps = {
      collectCi: async ({ windowDays }) =>
        runCollectCi({ store, config, cwd, days: windowDays }),
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

    if (actions.length === 0) {
      console.log("No actions needed. Current state matches flaker.toml.");
      if (!opts.json) {
        process.stderr.write(renderEmptyPlanHint() + "\n");
      }
      return;
    }

    const result = await executeDag(actions, deps);

    // Run --emit if requested
    let emitted: EmittedArtifact | undefined;
    if (opts.emit === "daily") {
      const dailyReport = await runOpsDaily({
        store,
        config,
        executeReleaseGate: async () => {
          const prepared = await prepareRunRequest({
            cwd,
            config,
            store,
            opts: { gate: "release" },
            deps: {
              detectChangedFiles,
              loadQuarantineManifestIfExists,
              createResolver: createConfiguredResolver,
            },
          });
          const execution = await executePreparedLocalRun({ store, config, cwd, prepared });
          return {
            exitCode: execution.runResult.exitCode,
            sampledCount: execution.runResult.sampledTests.length,
            holdoutCount: execution.runResult.holdoutTests.length,
            holdoutFailureCount: execution.recordResult?.holdoutFailureCount ?? 0,
          };
        },
      });
      emitted = { kind: "daily" as EmitKind, report: dailyReport };
    } else if (opts.emit === "weekly") {
      const weeklyReport = await runOpsWeekly({
        store,
        config,
        runner: createRunner(config.runner),
        cwd,
      });
      emitted = { kind: "weekly" as EmitKind, report: weeklyReport };
    }

    if (opts.json) {
      const output: Record<string, unknown> = { ...result };
      if (emitted) {
        output["emitted"] = emitted;
      }
      console.log(JSON.stringify(output, null, 2));
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

      if (emitted) {
        console.log("\n---");
        if (emitted.kind === "daily") {
          console.log(formatOpsDailyReport(emitted.report as Parameters<typeof formatOpsDailyReport>[0]));
        } else if (emitted.kind === "weekly") {
          console.log(formatOpsWeeklyReport(emitted.report as Parameters<typeof formatOpsWeeklyReport>[0]));
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
        emitted,
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
    .option("--emit <kind>", "Generate an ops cadence artifact alongside apply (daily|weekly|incident)")
    .action(applyAction);
}
