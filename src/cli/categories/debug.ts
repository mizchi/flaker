import type { Command } from "commander";
import { runDoctor, formatDoctorReport } from "../commands/debug/doctor.js";
import { runBisect } from "../commands/debug/bisect.js";
import { runRetry, formatRetryReport } from "../commands/debug/retry.js";
import { parseConfirmTarget, formatConfirmResult, confirmExitCode, type ConfirmVerdict } from "../commands/debug/confirm.js";
import { runConfirmLocal } from "../commands/debug/confirm-local.js";
import { runConfirmRemote } from "../commands/debug/confirm-remote.js";
import { loadConfig } from "../config.js";
import { DuckDBStore } from "../storage/duckdb.js";
import { createRunner } from "../runners/index.js";
import { createTestResultAdapter } from "../adapters/index.js";
import { resolve } from "node:path";

export function registerDebugCommands(program: Command): void {
  const debug = program
    .command("debug")
    .description("Active investigation and environment checks");

  debug
    .command("bisect")
    .description("Find commit range where a test became flaky")
    .requiredOption("--test <name>", "Test name")
    .option("--suite <suite>", "Suite (file path)")
    .action(async (opts: { test: string; suite?: string }) => {
      const config = loadConfig(process.cwd());
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();

      try {
        const result = await runBisect({
          store,
          suite: opts.suite ?? "",
          testName: opts.test,
        });
        if (result) {
          console.log(`Last good commit: ${result.lastGoodCommit} (${result.lastGoodDate.toISOString()})`);
          console.log(`First bad commit: ${result.firstBadCommit} (${result.firstBadDate.toISOString()})`);
        } else {
          console.log("No transition found.");
        }
      } finally {
        await store.close();
      }
    });

  debug
    .command("diagnose")
    .description("Diagnose flaky test causes by applying mutations (order, repeat, env, isolate)")
    .requiredOption("--suite <suite>", "Test suite file")
    .requiredOption("--test <name>", "Test name")
    .option("--runs <n>", "Number of runs per mutation", "3")
    .option("--mutations <list>", "Comma-separated mutation strategies: order,repeat,env,isolate,all", "all")
    .option("--json", "Output JSON report")
    .action(async (opts: { suite: string; test: string; runs: string; mutations: string; json?: boolean }) => {
      const config = loadConfig(process.cwd());
      const { createRunner } = await import("../runners/index.js");
      const runner = createRunner({
        type: config.runner.type,
        command: config.runner.command,
        execute: config.runner.execute,
        list: config.runner.list,
      });

      const mutations = opts.mutations.split(",").map((m) => m.trim());

      try {
        const { runDiagnose, formatDiagnoseReport } = await import("../commands/debug/diagnose.js");
        const report = await runDiagnose({
          runner,
          suite: opts.suite,
          testName: opts.test,
          runs: parseInt(opts.runs, 10),
          mutations,
          cwd: process.cwd(),
        });

        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(formatDiagnoseReport(report));
        }
      } catch (e: unknown) {
        console.error(`Error: ${e instanceof Error ? e.message : e}`);
        process.exit(1);
      }
    });

  debug
    .command("confirm <target>")
    .description("Re-run a specific test N times to distinguish broken/flaky/transient")
    .option("--repeat <n>", "Number of repetitions", "5")
    .option("--runner <mode>", "Execution mode: remote or local", "remote")
    .option("--workflow <name>", "Workflow filename for remote mode", "flaker-confirm.yml")
    .option("--json", "Machine-readable JSON output")
    .action(
      async (
        target: string,
        opts: { repeat: string; runner: string; workflow: string; json?: boolean },
      ) => {
        const { suite, testName } = parseConfirmTarget(target);
        const repeat = parseInt(opts.repeat, 10);
        if (!Number.isInteger(repeat) || repeat < 1) {
          console.error("Error: --repeat must be a positive integer");
          process.exit(1);
        }

        const config = loadConfig(process.cwd());
        if (!opts.json) {
          console.log(`# Confirm: ${suite} > ${testName} (${repeat}x, ${opts.runner})`);
          console.log("");
        }

        let result;
        if (opts.runner === "local") {
          const runner = createRunner(config.runner);
          result = await runConfirmLocal({
            suite,
            testName,
            repeat,
            runner,
            cwd: process.cwd(),
          });
        } else {
          const repo = `${config.repo.owner}/${config.repo.name}`;
          result = await runConfirmRemote({
            suite,
            testName,
            repeat,
            repo,
            workflow: opts.workflow,
            adapter: config.adapter.type,
          });
        }

        const output = formatConfirmResult(result, { json: opts.json });
        process.stdout.write(output + (output.endsWith("\n") ? "" : "\n"));
        const verdict = result.verdict.toUpperCase() as ConfirmVerdict;
        process.exit(confirmExitCode(verdict));
      },
    );

  const confirmCmd = debug.commands.find((c) => c.name() === "confirm");
  if (confirmCmd) {
    confirmCmd.addHelpText("after", `
Exit codes:
  0  TRANSIENT  Not reproducible
  1  FLAKY      Intermittent (pass and fail both observed)
  2  BROKEN     Regression reproduced
  3  ERROR      Runner or config failure

With --json, prints: {"verdict": "BROKEN|FLAKY|TRANSIENT", "runs": {...}}
`);
  }

  debug
    .command("retry")
    .description("Re-run failed tests from a CI workflow run locally")
    .option("--run <id>", "Workflow run ID (default: most recent failure)")
    .option("--repo <owner/name>", "Repository (default: from flaker.toml)")
    .action(
      async (opts: { run?: string; repo?: string }) => {
        const config = loadConfig(process.cwd());
        const repo = opts.repo ?? `${config.repo.owner}/${config.repo.name}`;
        const runId = opts.run ? parseInt(opts.run, 10) : undefined;
        const adapter = createTestResultAdapter(config.adapter.type, config.adapter.command);
        const runner = createRunner(config.runner);
        const artifactName = config.adapter.artifact_name ?? `${config.adapter.type}-report`;

        console.log("# Retry: fetching CI failures and running locally");
        console.log("");

        try {
          const { runId: resolvedRunId, results } = await runRetry({
            runId,
            repo,
            adapter,
            runner,
            artifactName,
            cwd: process.cwd(),
          });

          if (results.length === 0) {
            return;
          }

          console.log("");
          console.log(formatRetryReport(resolvedRunId, results));

          const reproduced = results.filter((r) => r.reproduced);
          if (reproduced.length > 0) {
            process.exit(1);
          }
        } catch (e) {
          console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
          process.exit(1);
        }
      },
    );

  debug
    .command("doctor")
    .description("Check local flaker runtime requirements")
    .action(async () => {
      const report = await runDoctor(process.cwd(), {
        createStore: () => new DuckDBStore(":memory:"),
      });
      console.log(formatDoctorReport(report));
      process.exit(report.ok ? 0 : 1);
    });
}
