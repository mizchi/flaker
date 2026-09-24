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
  type EmitKind,
  type EmittedArtifact,
} from "../commands/apply/artifact.js";
import type { StateDiff } from "../commands/apply/state.js";
import { runOpsDaily, formatOpsDailyReport } from "../commands/ops/daily.js";
import { runOpsWeekly, formatOpsWeeklyReport } from "../commands/ops/weekly.js";
import { runOpsIncident, formatOpsIncidentReport } from "../commands/ops/incident.js";
import { runRetry } from "../commands/debug/retry.js";
import { runConfirmLocal } from "../commands/debug/confirm-local.js";
import { runConfirmRemote } from "../commands/debug/confirm-remote.js";
import { runDiagnose } from "../commands/debug/diagnose.js";
import { createTestResultAdapter } from "../adapters/index.js";
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

const VALID_TARGETS = ["collect_ci", "calibrate", "cold_start_run", "quarantine_apply"] as const;
type Target = (typeof VALID_TARGETS)[number];

function newDriftKinds(current: StateDiff, planned: StateDiff): string[] {
  const plannedKinds = new Set(planned.drifts.map((d) => d.kind));
  return current.drifts
    .filter((d) => !plannedKinds.has(d.kind))
    .map((d) => d.kind);
}

export async function applyAction(opts: {
  json?: boolean;
  output?: string;
  emit?: string;
  target?: string;
  refreshOnly?: boolean;
  planFile?: string;
  force?: boolean;
  incidentRun?: string;
  incidentSuite?: string;
  incidentTest?: string;
  incidentRepeat?: string;
  incidentRunner?: string;
}): Promise<void> {
  // Mutual exclusion: --refresh-only and --plan-file
  if (opts.refreshOnly && opts.planFile) {
    console.error("Error: --refresh-only and --plan-file are mutually exclusive.");
    process.exitCode = 2;
    return;
  }

  // Mutual exclusion: --target and --plan-file (plan is already filtered)
  if (opts.target !== undefined && opts.planFile) {
    console.error("Error: --target and --plan-file are mutually exclusive (the plan is already filtered).");
    process.exitCode = 2;
    return;
  }

  // Validate --target value early
  if (opts.target !== undefined && !(VALID_TARGETS as readonly string[]).includes(opts.target)) {
    console.error(`Error: --target must be one of ${VALID_TARGETS.join(" | ")}. Got: ${opts.target}`);
    process.exitCode = 2;
    return;
  }

  // Validate --emit value early
  if (opts.emit !== undefined && !(VALID_EMIT_KINDS as readonly string[]).includes(opts.emit)) {
    console.error(`Error: --emit must be one of: ${VALID_EMIT_KINDS.join(", ")}`);
    process.exitCode = 2;
    return;
  }
  if (opts.emit === "incident") {
    const hasRun = opts.incidentRun !== undefined;
    const hasSuite = opts.incidentSuite !== undefined;
    const hasTest = opts.incidentTest !== undefined;
    if (!hasRun && !(hasSuite && hasTest)) {
      console.error(
        "Error: --emit incident requires --incident-run <id> OR both --incident-suite and --incident-test.",
      );
      process.exitCode = 2;
      return;
    }
    if ((hasSuite && !hasTest) || (!hasSuite && hasTest)) {
      console.error(
        "Error: --incident-suite and --incident-test must be provided together.",
      );
      process.exitCode = 2;
      return;
    }
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
        const { analyzeProject, recommendSampling } = await import(
          "../commands/collect/calibrate.js"
        );
        const hasResolver =
          config.affected.resolver !== "" && config.affected.resolver !== "none";
        const profile = await analyzeProject(store, {
          hasResolver,
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

    let dagResult: Awaited<ReturnType<typeof executeDag>>;
    let skippedByTarget: import("../commands/apply/dag.js").DagExecutedAction[] = [];

    if (opts.target !== undefined) {
      const targetKind = opts.target as Target;
      const toRun = actions.filter((a) => a.kind === targetKind);
      const toSkip = actions.filter((a) => a.kind !== targetKind);
      dagResult = await executeDag(toRun, deps);
      skippedByTarget = toSkip.map((a) => ({
        kind: a.kind,
        status: "skipped" as const,
        skippedReason: "not in --target",
      }));
    } else {
      dagResult = await executeDag(actions, deps);
    }

    // Merge executed + skipped-by-target preserving original plan order
    const executedByKind = new Map(dagResult.executed.map((e) => [e.kind, e]));
    const skippedByKindMap = new Map(skippedByTarget.map((s) => [s.kind, s]));
    const mergedExecuted = actions.map((a) => {
      return executedByKind.get(a.kind) ?? skippedByKindMap.get(a.kind)!;
    });
    const result = { executed: mergedExecuted };

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
    } else if (opts.emit === "incident") {
      const runner = createRunner(config.runner);
      const adapter = createTestResultAdapter(config.adapter.type, config.adapter.command);
      const repo = `${config.repo.owner}/${config.repo.name}`;
      const runId = opts.incidentRun ? parseInt(opts.incidentRun, 10) : undefined;
      const repeat = opts.incidentRepeat ? parseInt(opts.incidentRepeat, 10) : 5;
      const confirmRunner = (opts.incidentRunner as "local" | "remote" | undefined) ?? "local";
      const incidentReport = await runOpsIncident({
        runId,
        suite: opts.incidentSuite,
        testName: opts.incidentTest,
        repeat,
        confirmRunner,
        diagnoseRuns: 3,
        retry: runId == null
          ? undefined
          : async (resolvedRunId) =>
            runRetry({
              runId: resolvedRunId,
              repo,
              adapter,
              runner,
              artifactName: config.adapter.artifact_name ?? `${config.adapter.type}-report`,
              cwd,
            }),
        confirm: !(opts.incidentSuite && opts.incidentTest)
          ? undefined
          : async ({ suite, testName, repeat: resolvedRepeat, runner: resolvedRunner }) =>
            resolvedRunner === "local"
              ? runConfirmLocal({
                suite,
                testName,
                repeat: resolvedRepeat,
                runner,
                cwd,
              })
              : runConfirmRemote({
                suite,
                testName,
                repeat: resolvedRepeat,
                repo,
                workflow: "flaker-confirm.yml",
                adapter: config.adapter.type,
              }),
        diagnose: !(opts.incidentSuite && opts.incidentTest)
          ? undefined
          : async ({ suite, testName, runs }) =>
            runDiagnose({
              runner,
              suite,
              testName,
              runs,
              mutations: ["all"],
              cwd,
            }),
      });
      emitted = { kind: "incident" as EmitKind, report: incidentReport };
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
        } else if (emitted.kind === "incident") {
          console.log(formatOpsIncidentReport(emitted.report as Parameters<typeof formatOpsIncidentReport>[0]));
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
    .option("--target <kind>", "Run only actions of this kind (collect_ci|calibrate|cold_start_run|quarantine_apply)")
    .option("--refresh-only", "Run probe + state-diff + plan but skip execution (writes PlanArtifact if --output set)")
    .option("--plan-file <file>", "Load a previously-saved PlanArtifact and execute its stored actions")
    .option("--force", "Force execution even if repo state has drifted from the plan file")
    .option("--incident-run <id>", "Workflow run ID for incident retry (use with --emit incident)")
    .option("--incident-suite <name>", "Suite path for incident confirm/diagnose (use with --emit incident)")
    .option("--incident-test <name>", "Test name for incident confirm/diagnose (use with --emit incident)")
    .option("--incident-repeat <n>", "Number of confirm repetitions for incident (default 5)")
    .option("--incident-runner <mode>", "Confirm runner for incident: local or remote (default local)")
    .action(applyAction);
}
