import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { deprecate } from "../deprecation.js";
import { DuckDBStore } from "../storage/duckdb.js";
import { prepareRunRequest } from "../commands/exec/prepare-run-request.js";
import { executePreparedLocalRun } from "../commands/exec/execute-prepared-local-run.js";
import { createConfiguredResolver } from "./shared-resolver.js";
import { detectChangedFiles } from "../core/git.js";
import { loadQuarantineManifestIfExists } from "../quarantine-manifest.js";
import { formatOpsDailyReport, runOpsDaily } from "../commands/ops/daily.js";
import { createRunner } from "../runners/index.js";
import { formatOpsWeeklyReport, runOpsWeekly } from "../commands/ops/weekly.js";
import { formatOpsIncidentReport, runOpsIncident } from "../commands/ops/incident.js";
import { runRetry } from "../commands/debug/retry.js";
import { runConfirmLocal } from "../commands/debug/confirm-local.js";
import { runConfirmRemote } from "../commands/debug/confirm-remote.js";
import { runDiagnose } from "../commands/debug/diagnose.js";
import { createTestResultAdapter } from "../adapters/index.js";

function writeOutput(path: string, content: string): void {
  const target = resolve(process.cwd(), path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

export async function opsWeeklyAction(
  opts: { windowDays: string; json?: boolean; output?: string },
): Promise<void> {
  const config = loadConfig(process.cwd());
  const store = new DuckDBStore(resolve(config.storage.path));
  await store.initialize();
  try {
    const report = await runOpsWeekly({
      store,
      config,
      runner: createRunner(config.runner),
      cwd: process.cwd(),
      windowDays: parseInt(opts.windowDays, 10),
    });
    const rendered = opts.json ? JSON.stringify(report, null, 2) : formatOpsWeeklyReport(report);
    if (opts.output) {
      writeOutput(opts.output, rendered);
    }
    console.log(rendered);
  } finally {
    await store.close();
  }
}

export async function opsDailyAction(
  opts: { windowDays: string; json?: boolean; output?: string },
): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const store = new DuckDBStore(resolve(config.storage.path));
  await store.initialize();
  try {
    const report = await runOpsDaily({
      store,
      config,
      windowDays: parseInt(opts.windowDays, 10),
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
        const execution = await executePreparedLocalRun({
          store,
          config,
          cwd,
          prepared,
        });
        return {
          exitCode: execution.runResult.exitCode,
          sampledCount: execution.runResult.sampledTests.length,
          holdoutCount: execution.runResult.holdoutTests.length,
          holdoutFailureCount: execution.recordResult?.holdoutFailureCount ?? 0,
        };
      },
    });
    const rendered = opts.json ? JSON.stringify(report, null, 2) : formatOpsDailyReport(report);
    if (opts.output) {
      writeOutput(opts.output, rendered);
    }
    console.log(rendered);
    if (report.releaseRun.exitCode !== 0) {
      process.exit(1);
    }
  } finally {
    await store.close();
  }
}

export async function opsIncidentAction(
  opts: {
    run?: string;
    suite?: string;
    test?: string;
    repeat?: string;
    runner?: "remote" | "local";
    workflow?: string;
    runs?: string;
    json?: boolean;
    output?: string;
  },
): Promise<void> {
  if (!opts.run && !(opts.suite && opts.test)) {
    console.error("Error: provide --run or both --suite and --test");
    process.exit(2);
  }
  if ((opts.suite && !opts.test) || (!opts.suite && opts.test)) {
    console.error("Error: --suite and --test must be provided together");
    process.exit(2);
  }

  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const runner = createRunner(config.runner);
  const adapter = createTestResultAdapter(config.adapter.type, config.adapter.command);
  const repo = `${config.repo.owner}/${config.repo.name}`;
  const runId = opts.run ? parseInt(opts.run, 10) : undefined;
  const repeat = opts.repeat ? parseInt(opts.repeat, 10) : 5;
  const diagnoseRuns = opts.runs ? parseInt(opts.runs, 10) : 3;
  const confirmRunner = opts.runner ?? "local";

  const report = await runOpsIncident({
    runId,
    suite: opts.suite,
    testName: opts.test,
    repeat,
    confirmRunner,
    diagnoseRuns,
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
    confirm: !(opts.suite && opts.test)
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
            workflow: opts.workflow ?? "flaker-confirm.yml",
            adapter: config.adapter.type,
          }),
    diagnose: !(opts.suite && opts.test)
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

  const rendered = opts.json ? JSON.stringify(report, null, 2) : formatOpsIncidentReport(report);
  if (opts.output) {
    writeOutput(opts.output, rendered);
  }
  console.log(rendered);
}

export function registerOpsCommands(program: Command): void {
  const ops = program
    .command("ops")
    .description("Operator cadence commands");

  const dailyCmd = ops
    .command("daily")
    .description("Run the daily observation loop and render an artifact")
    .option("--window-days <days>", "Analysis window in days", "1")
    .option("--json", "Output as JSON")
    .option("--output <file>", "Write the rendered artifact to a file")
    .action(opsDailyAction);
  deprecate(dailyCmd, { since: "0.9.0", remove: "1.0.0", canonical: "flaker apply --emit daily" });

  ops
    .command("weekly")
    .description("Generate a weekly operator review artifact")
    .option("--window-days <days>", "Analysis window in days", "7")
    .option("--json", "Output as JSON")
    .option("--output <file>", "Write the rendered artifact to a file")
    .action(opsWeeklyAction);

  ops
    .command("incident")
    .description("Bundle retry, confirm, and diagnose into one incident artifact")
    .option("--run <id>", "Workflow run ID for retry")
    .option("--suite <suite>", "Suite path for confirm/diagnose")
    .option("--test <name>", "Test name for confirm/diagnose")
    .option("--repeat <n>", "Number of confirm repetitions", "5")
    .option("--runner <mode>", "Confirm runner: local or remote", "local")
    .option("--workflow <name>", "Workflow filename for remote confirm", "flaker-confirm.yml")
    .option("--runs <n>", "Number of diagnose runs", "3")
    .option("--json", "Output as JSON")
    .option("--output <file>", "Write the rendered artifact to a file")
    .action(opsIncidentAction);
}
