import { resolve } from "node:path";
import type { Command } from "commander";
import { deprecate } from "../deprecation.js";
import { Octokit } from "@octokit/rest";
import { loadConfig, writeSamplingConfig, type FlakerConfig } from "../config.js";
import {
  collectWorkflowRuns,
  formatCollectSummary,
  resolveCollectExitCode,
  writeCollectSummary,
  type CollectResult,
  type GitHubClient,
} from "../commands/collect/ci.js";
import { runCollectLocal } from "../commands/collect/local.js";
import { DuckDBStore } from "../storage/duckdb.js";
import type { MetricStore } from "../storage/types.js";

export interface RunCollectCiOpts {
  store: MetricStore;
  config: FlakerConfig;
  cwd: string;
  days: number;
  branch?: string;
  failOnErrors?: boolean;
}

export interface RunCollectCiResult {
  result: CollectResult;
  exitCode: number;
}

/**
 * Core collect-ci logic that throws on fatal errors (e.g. missing GITHUB_TOKEN)
 * instead of calling process.exit. Suitable for use by applyAction and other
 * programmatic callers that need clean error propagation.
 */
export async function runCollectCi(opts: RunCollectCiOpts): Promise<RunCollectCiResult> {
  const { store, config, cwd: _cwd, days, branch, failOnErrors } = opts;

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN environment variable is required");
  }

  const octokit = new Octokit({ auth: token });
  const owner = config.repo.owner;
  const repo = config.repo.name;

  const github: GitHubClient = {
    async listWorkflowRuns() {
      const created = new Date();
      created.setDate(created.getDate() - days);
      const response = await octokit.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        ...(branch ? { branch } : {}),
        created: `>=${created.toISOString().split("T")[0]}`,
        per_page: 100,
      });
      return {
        total_count: response.data.total_count,
        workflow_runs: response.data.workflow_runs.map((run) => ({
          id: run.id,
          path: (run as { path?: string }).path,
          status: run.status ?? undefined,
          head_branch: run.head_branch ?? "",
          head_sha: run.head_sha,
          event: run.event,
          conclusion: run.conclusion ?? "unknown",
          created_at: run.created_at,
          run_started_at: run.run_started_at ?? run.created_at,
          updated_at: run.updated_at,
        })),
      };
    },
    async listArtifacts(runId: number) {
      const response = await octokit.actions.listWorkflowRunArtifacts({
        owner,
        repo,
        run_id: runId,
      });
      return response.data;
    },
    async downloadArtifact(artifactId: number) {
      const response = await octokit.actions.downloadArtifact({
        owner,
        repo,
        artifact_id: artifactId,
        archive_format: "zip",
      });
      return Buffer.from(response.data as ArrayBuffer);
    },
    async getCommitFiles(o: string, r: string, sha: string) {
      const response = await octokit.repos.getCommit({ owner: o, repo: r, ref: sha });
      return (response.data.files ?? []).map((f) => ({
        filename: f.filename,
        status: f.status ?? "modified",
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
      }));
    },
  };

  const result = await collectWorkflowRuns({
    store,
    github,
    repo: `${owner}/${repo}`,
    adapterType: config.adapter.type,
    artifactName: config.adapter.artifact_name,
    customCommand: config.adapter.command,
    storagePath: config.storage.path,
    workflowPaths: config.collect?.workflow_paths,
  });

  const exitCode = resolveCollectExitCode(result, { failOnErrors });
  return { result, exitCode };
}

export async function collectCiAction(opts: { days: string; branch?: string; json?: boolean; output?: string; failOnErrors?: boolean }): Promise<void> {
  const config = loadConfig(process.cwd());
  const store = new DuckDBStore(resolve(config.storage.path));
  await store.initialize();

  try {
    const { result, exitCode } = await runCollectCi({
      store,
      config,
      cwd: process.cwd(),
      days: Number(opts.days),
      branch: opts.branch,
      failOnErrors: opts.failOnErrors,
    });
    const formatted = formatCollectSummary(result, opts.json ? "json" : "text");
    console.log(formatted);
    if (opts.output) {
      writeCollectSummary(resolve(process.cwd(), opts.output), formatted);
    }
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    await store.close();
  }
}

export function registerCollectCommands(program: Command): void {
  const collectCmd = program
    .command("collect")
    .description("Import history and calibration")
    .option("--days <n>", "Number of days to look back", "30")
    .option("--branch <branch>", "Filter by branch")
    .option("--json", "Output JSON summary")
    .option("--output <file>", "Write collect summary to a file")
    .option("--fail-on-errors", "Exit with status 1 when any workflow run fails to collect")
    .action(collectCiAction);
  deprecate(collectCmd, { since: "0.7.0", remove: "0.8.0", canonical: "flaker apply" });

  // --- collect ci ---
  const collectCiCmd = collectCmd
    .command("ci")
    .description("Collect workflow runs from GitHub")
    .option("--days <n>", "Number of days to look back", "30")
    .option("--branch <branch>", "Filter by branch")
    .option("--json", "Output JSON summary")
    .option("--output <file>", "Write collect summary to a file")
    .option("--fail-on-errors", "Exit with status 1 when any workflow run fails to collect")
    .action(collectCiAction);
  deprecate(collectCiCmd, { since: "0.7.0", remove: "0.8.0", canonical: "flaker apply" });

  // --- collect local ---
  const collectLocalCmd = collectCmd
    .command("local")
    .description("Import actrun local run history into flaker")
    .option("--last <n>", "Import only last N runs")
    .action(async (opts: { last?: string }) => {
      const config = loadConfig(process.cwd());
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();
      try {
        const result = await runCollectLocal({
          store,
          last: opts.last ? Number(opts.last) : undefined,
          storagePath: config.storage.path,
        });
        console.log(`Imported ${result.runsImported} runs, ${result.testsImported} test results`);
        if (result.runsImported > 0) {
          const { runEval, formatEvalReport } = await import("../commands/analyze/eval.js");
          const evalReport = await runEval({ store });
          console.log(formatEvalReport(evalReport));
        }
      } finally {
        await store.close();
      }
    });
  deprecate(collectLocalCmd, { since: "0.7.0", remove: "0.8.0", canonical: "flaker apply" });

  // --- collect coverage ---
  const collectCoverageCmd = collectCmd
    .command("coverage")
    .description("Collect test coverage data and store edges in DuckDB")
    .requiredOption("--format <type>", "Coverage format: istanbul, v8, playwright")
    .requiredOption("--input <path>", "Path to coverage JSON file or directory")
    .option("--test-id-prefix <prefix>", "Prefix for test IDs (e.g. commit SHA)")
    .action(async (opts: { format: string; input: string; testIdPrefix?: string }) => {
      const config = loadConfig(process.cwd());
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();
      try {
        const { collectCoverage, formatCollectCoverageSummary } = await import("../commands/collect/coverage.js");
        const result = await collectCoverage({
          store,
          format: opts.format,
          input: opts.input,
          testIdPrefix: opts.testIdPrefix,
        });
        console.log(formatCollectCoverageSummary(result));
      } catch (e: unknown) {
        console.error(`Error: ${e instanceof Error ? e.message : e}`);
        process.exit(1);
      } finally {
        await store.close();
      }
    });
  deprecate(collectCoverageCmd, { since: "0.7.0", remove: "0.8.0", canonical: "flaker apply" });

  // --- collect commit-changes ---
  const collectCommitChangesCmd = collectCmd
    .command("commit-changes")
    .description("Collect commit change data")
    .action(async () => {
      // This command has no direct top-level equivalent action body in main.ts.
      // The collect-commit-changes module is used as a helper by other commands.
      // Expose it as a noop placeholder that shows help.
      console.error("Error: collect commit-changes requires --commit <sha> option");
      process.exit(1);
    });
  deprecate(collectCommitChangesCmd, { since: "0.7.0", remove: "0.8.0", canonical: "flaker apply" });

  // --- collect calibrate ---
  const collectCalibrateCmd = collectCmd
    .command("calibrate")
    .description("Analyze project history and write optimal [sampling] config to flaker.toml")
    .option("--window-days <days>", "Analysis window in days", "90")
    .option("--dry-run", "Show recommendation without writing to flaker.toml")
    .option("--explain", "Output JSON context for LLM-assisted calibration")
    .action(async (opts: { windowDays: string; dryRun?: boolean; explain?: boolean }) => {
      const { existsSync } = await import("node:fs");
      const cwd = process.cwd();
      const config = loadConfig(cwd);
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();
      try {
        const { analyzeProject, recommendSampling, formatCalibrationReport, buildExplainContext, queryTopTests } = await import("../commands/collect/calibrate.js");

        const hasResolver = config.affected.resolver !== "" && config.affected.resolver !== "none";
        const modelPath = resolve(".flaker", "models", "gbdt.json");
        const hasGBDTModel = existsSync(modelPath);

        const profile = await analyzeProject(store, {
          hasResolver,
          hasGBDTModel,
          windowDays: parseInt(opts.windowDays, 10),
        });
        const sampling = recommendSampling(profile);
        const result = { profile, sampling };

        if (opts.explain) {
          const topTests = await queryTopTests(store, parseInt(opts.windowDays, 10));
          console.log(JSON.stringify(buildExplainContext(result, topTests), null, 2));
          return;
        }

        console.log(formatCalibrationReport(result));

        if (!opts.dryRun) {
          writeSamplingConfig(cwd, sampling);
          console.log(`\nWritten to flaker.toml [sampling] section.`);
        } else {
          console.log(`\n(dry run — flaker.toml not modified)`);
        }
      } finally {
        await store.close();
      }
    });
  deprecate(collectCalibrateCmd, { since: "0.7.0", remove: "0.8.0", canonical: "flaker apply" });
}
