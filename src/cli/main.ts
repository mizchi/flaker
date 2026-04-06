#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { Octokit } from "@octokit/rest";
import { loadConfig, writeSamplingConfig, type SamplingConfig, type FlakerConfig } from "./config.js";
import { runInit } from "./commands/init.js";
import {
  collectWorkflowRuns,
  formatCollectSummary,
  resolveCollectExitCode,
  writeCollectSummary,
  type GitHubClient,
} from "./commands/collect.js";
import { runFlaky, formatFlakyTable, runFlakyTrend, formatFlakyTrend, runTrueFlaky, formatTrueFlakyTable } from "./commands/flaky.js";
import {
  formatSamplingSummary,
  planSample,
} from "./commands/sample.js";
import { recordSamplingRunFromSummary } from "./commands/sampling-run.js";
import { runTests } from "./commands/run.js";
import {
  parseSampleCount,
  parseSamplePercentage,
  parseSamplingMode,
} from "./commands/sampling-options.js";
import { ActrunRunner } from "./runners/actrun.js";
import { runBisect } from "./commands/bisect.js";
import { runImport } from "./commands/import.js";
import { loadTuningConfig, type TuningConfig } from "./eval/alpha-tuner.js";

function loadTuningConfigSafe(storagePath: string): TuningConfig {
  try {
    return loadTuningConfig(storagePath);
  } catch {
    return { alpha: 1.0 };
  }
}
import { runCollectLocal } from "./commands/collect-local.js";
import { runQuery, formatQueryResult } from "./commands/query.js";
import {
  runQuarantine,
  formatQuarantineTable,
} from "./commands/quarantine.js";
import {
  runEval,
  formatEvalReport,
  runSamplingKpi,
} from "./commands/eval.js";
import { runReason, formatReasoningReport } from "./commands/reason.js";
import { runSelfEval, formatSelfEvalReport } from "./commands/self-eval.js";
import { generateFixture } from "./eval/fixture-generator.js";
import { loadFixtureIntoStore } from "./eval/fixture-loader.js";
import { evaluateFixture } from "./eval/fixture-evaluator.js";
import { formatEvalFixtureReport, formatSweepReport, formatMultiSweepReport } from "./eval/fixture-report.js";
import { runDoctor, formatDoctorReport } from "./commands/doctor.js";
import {
  runAffected,
  formatAffectedReport,
} from "./commands/affected.js";
import {
  discoverTestSpecsForCheck,
  formatConfigCheckReport,
  loadTaskDefinitionsForCheck,
  runConfigCheck,
} from "./commands/check.js";
import {
  createReportSummaryArtifact,
  formatReportAggregate,
  formatReportDiff,
  formatReportSummary,
  loadReportSummaryArtifactsFromDir,
  parseReportSummary,
  runReportAggregate,
  runReportDiff,
  runReportSummarize,
} from "./commands/report.js";
import { DuckDBStore } from "./storage/duckdb.js";
import { createRunner } from "./runners/index.js";
import { resolveTestIdentity } from "./identity.js";
import { toStoredTestResult } from "./storage/test-result-mapper.js";
import { createResolver } from "./resolvers/index.js";
import { resolveCurrentCommitSha, detectChangedFiles, detectRepoInfo } from "./core/git.js";
import {
  formatQuarantineManifestReport,
  loadQuarantineManifest,
  loadQuarantineManifestIfExists,
  resolveQuarantineManifestPath,
  validateQuarantineManifest,
} from "./quarantine-manifest.js";
import { detectProfileName, resolveProfile, computeAdaptivePercentage, type ResolvedProfile } from "./profile.js";
import { computeKpi } from "./commands/kpi.js";
import { runInsights } from "./commands/insights.js";

function formatHelpExamples(
  title: string,
  examples: string[],
): string {
  return `\n${title}:\n${examples.map((example) => `  ${example}`).join("\n")}\n`;
}

function appendHelpText<T extends Command>(
  command: T,
  extra: string,
): T {
  const originalHelpInformation = command.helpInformation.bind(command);
  command.helpInformation = () => `${originalHelpInformation()}${extra}`;
  return command;
}

function appendExamplesToCommand(
  command: Command | undefined,
  examples: string[],
): void {
  if (!command) return;
  appendHelpText(command, formatHelpExamples("Examples", examples));
}

function isDirectCliExecution(): boolean {
  return process.argv[1] != null
    && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

export function createProgram(): Command {
  const program = new Command();

async function collectKnownQuarantineTaskIds(
  cwd: string,
  store: DuckDBStore,
  runnerConfig: {
    type: string;
    command: string;
    execute?: string;
    list?: string;
  },
): Promise<string[]> {
  const taskIds = new Set<string>();
  const persisted = await store.raw<{ task_id: string }>(`
    SELECT DISTINCT task_id
    FROM test_results
    WHERE task_id IS NOT NULL AND task_id <> ''
  `);
  for (const row of persisted) {
    taskIds.add(row.task_id);
  }

  try {
    const runner = createRunner(runnerConfig);
    const listedTests = await runner.listTests({ cwd });
    for (const test of listedTests) {
      const resolved = resolveTestIdentity({
        suite: test.suite,
        testName: test.testName,
        taskId: test.taskId,
        filter: test.filter,
        variant: test.variant,
      });
      taskIds.add(resolved.taskId);
    }
  } catch {
    // Best-effort: fall back to persisted task ids only.
  }

  return [...taskIds].sort();
}

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

function parseKeyValuePairs(input?: string): Record<string, string> | undefined {
  if (!input) return undefined;
  const entries = input
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator === -1) {
        throw new Error(`Invalid key=value pair: ${part}`);
      }
      return [part.slice(0, separator), part.slice(separator + 1)] as const;
    });
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

function parseChangedFiles(input?: string): string[] | undefined {
  const files = input
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return files && files.length > 0 ? files : undefined;
}

async function createConfiguredResolver(
  cwd: string,
  affectedConfig: { resolver: string; config: string },
) {
  return createResolver(
    {
      resolver: affectedConfig.resolver ?? "simple",
      config: affectedConfig.config ? resolve(cwd, affectedConfig.config) : undefined,
    },
    cwd,
  );
}

interface SamplingCliOpts {
  profile?: string;
  strategy: string;
  count?: string;
  percentage?: string;
  skipQuarantined?: boolean;
  changed?: string;
  coFailureDays?: string;
  holdoutRatio?: string;
  modelPath?: string;
}

function addSamplingOptions<T extends Command>(cmd: T): T {
  return cmd
    .option("--profile <name>", "Execution profile: daily, ci, local (auto-detected if omitted)")
    .option("--strategy <s>", "Sampling strategy: random, weighted, affected, hybrid, gbdt, full")
    .option("--count <n>", "Number of tests to sample")
    .option("--percentage <n>", "Percentage of tests to sample")
    .option("--skip-quarantined", "Exclude quarantined tests")
    .option("--changed <files>", "Comma-separated list of changed files (for affected/hybrid)")
    .option("--co-failure-days <days>", "Co-failure analysis window in days")
    .option("--holdout-ratio <ratio>", "Fraction of skipped tests to run as holdout (0-1)")
    .option("--model-path <path>", "Path to GBDT model JSON") as T;
}

interface ResolvedSamplingOpts {
  resolvedProfile: ResolvedProfile;
  strategy: string;
  count?: number;
  percentage?: number;
  skipQuarantined?: boolean;
  changed?: string;
  coFailureDays?: number;
  holdoutRatio?: number;
  modelPath?: string;
}

/** Merge CLI options with [sampling] config and parse to final types. CLI args take priority. */
function resolveSamplingOpts(
  opts: SamplingCliOpts,
  config: FlakerConfig,
): ResolvedSamplingOpts {
  const profileName = detectProfileName(opts.profile);
  const profile = resolveProfile(profileName, config.profile, config.sampling);

  return {
    resolvedProfile: profile,
    strategy: opts.strategy ?? profile.strategy,
    count: parseSampleCount(opts.count),
    percentage: parseSamplePercentage(opts.percentage) ?? profile.percentage,
    skipQuarantined: opts.skipQuarantined ?? profile.skip_quarantined,
    changed: opts.changed,
    coFailureDays: opts.coFailureDays ? parseInt(opts.coFailureDays, 10) : profile.co_failure_days,
    holdoutRatio: opts.holdoutRatio ? parseFloat(opts.holdoutRatio) : profile.holdout_ratio,
    modelPath: opts.modelPath ?? profile.model_path,
  };
}

/** Auto-detect changed files if not explicitly provided. */
function resolveChangedFiles(cwd: string, explicit?: string): string[] | undefined {
  const parsed = parseChangedFiles(explicit);
  if (parsed) return parsed;
  // Auto-detect from git
  const detected = detectChangedFiles(cwd);
  return detected.length > 0 ? detected : undefined;
}

program
  .name("flaker")
  .description("Intelligent test selection — run fewer tests, catch more failures")
  .version("0.1.0")
  .showHelpAfterError()
  .showSuggestionAfterError();

appendHelpText(
  program,
  "\nGetting started (3 commands):\n" +
  "  flaker init                  Set up flaker.toml (auto-detects repo from git)\n" +
  "  flaker calibrate             Analyze history, write optimal sampling config\n" +
  "  flaker run                   Select and execute tests (uses calibrated config)\n" +
  "\n" +
  "Building history:\n" +
  "  flaker collect --last 30     Import CI runs from GitHub Actions\n" +
  "  flaker collect-local         Import local actrun history\n" +
  "\n" +
  "Analysis:\n" +
  "  flaker kpi                   KPI dashboard (sampling, flaky, data quality)\n" +
  "  flaker flaky                 Show flaky test rankings\n" +
  "  flaker insights              Compare CI vs local failure patterns\n" +
  "  flaker eval                  Detailed evaluation report\n" +
  "\n" +
  "Advanced:\n" +
  "  flaker train                 Train GBDT model for ML-based selection\n" +
  "  flaker eval-fixture          Benchmark strategies with synthetic data\n" +
  "  flaker doctor                Check runtime requirements\n",
);

// --- init ---
program
  .command("init")
  .description("Create flaker.toml (auto-detects owner/name from git remote)")
  .option("--owner <owner>", "Repository owner (auto-detected from git remote)")
  .option("--name <name>", "Repository name (auto-detected from git remote)")
  .action((opts: { owner?: string; name?: string }) => {
    const cwd = process.cwd();
    const detected = detectRepoInfo(cwd);
    const owner = opts.owner ?? detected?.owner ?? "local";
    const name = opts.name ?? detected?.name ?? basename(cwd);
    runInit(cwd, { owner, name });
    if (!detected && !opts.owner) {
      console.log(`Initialized flaker.toml (${owner}/${name}) — no git remote found, using defaults`);
    } else {
      console.log(`Initialized flaker.toml (${owner}/${name})`);
    }
  });

// --- collect ---
program
  .command("collect")
  .description("Collect workflow runs from GitHub")
  .option("--last <days>", "Number of days to look back", "30")
  .option("--branch <branch>", "Filter by branch")
  .option("--json", "Output JSON summary")
  .option("--output <file>", "Write collect summary to a file")
  .option("--fail-on-errors", "Exit with status 1 when any workflow run fails to collect")
  .action(async (opts: { last: string; branch?: string; json?: boolean; output?: string; failOnErrors?: boolean }) => {
    const config = loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      console.error("Error: GITHUB_TOKEN environment variable is required");
      process.exit(1);
    }

    const octokit = new Octokit({ auth: token });
    const owner = config.repo.owner;
    const repo = config.repo.name;

    const github: GitHubClient = {
      async listWorkflowRuns() {
        const created = new Date();
        created.setDate(created.getDate() - Number(opts.last));
        const response = await octokit.actions.listWorkflowRunsForRepo({
          owner,
          repo,
          ...(opts.branch ? { branch: opts.branch } : {}),
          created: `>=${created.toISOString().split("T")[0]}`,
          per_page: 100,
        });
        return {
          total_count: response.data.total_count,
          workflow_runs: response.data.workflow_runs.map((run) => ({
            id: run.id,
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

    try {
      const result = await collectWorkflowRuns({
        store,
        github,
        repo: `${owner}/${repo}`,
        adapterType: config.adapter.type,
        artifactName: config.adapter.artifact_name,
        customCommand: config.adapter.command,
        storagePath: config.storage.path,
      });
      const formatted = formatCollectSummary(result, opts.json ? "json" : "text");
      console.log(formatted);
      if (opts.output) {
        writeCollectSummary(resolve(process.cwd(), opts.output), formatted);
      }
      const exitCode = resolveCollectExitCode(result, { failOnErrors: opts.failOnErrors });
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    } finally {
      await store.close();
    }
  });

// --- flaky ---
program
  .command("flaky")
  .description("Inspect flaky tests and failure-rate trends")
  .option("--top <n>", "Number of top flaky tests to show")
  .option("--test <filter>", "Filter by test name")
  .option("--trend", "Show weekly flaky trend (requires --test)")
  .option("--true-flaky", "Show true flaky tests (same commit with both pass and fail)")
  .action(async (opts: { top?: string; test?: string; trend?: boolean; trueFlaky?: boolean }) => {
    const config = loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();

    try {
      if (opts.trueFlaky) {
        const results = await runTrueFlaky({
          store,
          top: opts.top ? Number(opts.top) : undefined,
        });
        console.log(formatTrueFlakyTable(results));
        return;
      }
      if (opts.trend && opts.test) {
        const entries = await runFlakyTrend({ store, suite: "", testName: opts.test });
        console.log(formatFlakyTrend(entries));
        return;
      }
      const results = await runFlaky({
        store,
        top: opts.top ? Number(opts.top) : undefined,
        testName: opts.test,
      });
      console.log(formatFlakyTable(results));
    } finally {
      await store.close();
    }
  });

// --- sample ---
addSamplingOptions(
  program
    .command("sample")
    .description("Select tests without executing (dry run of test selection)"),
).action(
    async (rawOpts: SamplingCliOpts) => {
      const config = loadConfig(process.cwd());
      const opts = resolveSamplingOpts(rawOpts, config);
      console.log(`# Profile: ${opts.resolvedProfile.name}`);
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();

      try {
        const cwd = process.cwd();
        const changedFiles = resolveChangedFiles(cwd, opts.changed);
        const mode = parseSamplingMode(opts.strategy);
        const manifest = opts.skipQuarantined
          ? loadQuarantineManifestIfExists({ cwd })
          : null;
        const listedTests = await listRunnerTests(cwd, config.runner);

        // Create resolver from config for affected/hybrid
        let resolver;
        if ((mode === "affected" || mode === "hybrid") && changedFiles?.length) {
          resolver = await createConfiguredResolver(cwd, config.affected);
        }

        const kpi = await runSamplingKpi({ store });
        const samplePlan = await planSample({
          store,
          mode,
          count: opts.count,
          percentage: opts.percentage,
          skipQuarantined: opts.skipQuarantined,
          resolver,
          changedFiles,
          quarantineManifestEntries: manifest?.entries,
          listedTests,
          coFailureDays: opts.coFailureDays,
          coFailureAlpha: loadTuningConfigSafe(config.storage.path).alpha,
          holdoutRatio: opts.holdoutRatio,
          modelPath: opts.modelPath,
        });
        await recordSamplingRunFromSummary(store, {
          commitSha: resolveCurrentCommitSha(process.cwd()),
          commandKind: "sample",
          summary: samplePlan.summary,
          tests: samplePlan.sampled,
          holdoutTests: samplePlan.holdout,
        });
        console.log(formatSamplingSummary(samplePlan.summary, {
          ciPassWhenLocalPassRate: kpi.passSignal.rate,
        }));
        if (samplePlan.sampled.length > 0) {
          console.log("");
        }
        for (const t of samplePlan.sampled) {
          console.log(`${t.suite} > ${t.test_name}`);
        }
        if (samplePlan.holdout.length > 0) {
          console.log(`\n# Holdout tests (${samplePlan.holdout.length})`);
          for (const t of samplePlan.holdout) {
            console.log(`${t.suite} > ${t.test_name}`);
          }
        }
      } finally {
        await store.close();
      }
    },
  );

// --- run ---
addSamplingOptions(
  program
    .command("run")
    .description("Select and run tests (auto-detects changed files and strategy from config)")
    .option("--runner <runner>", "Runner type: direct or actrun", "direct")
    .option("--retry", "Retry failed tests (actrun only)"),
).action(
    async (rawOpts: SamplingCliOpts & { runner: string; retry?: boolean }) => {
      const cwd = process.cwd();
      const config = loadConfig(cwd);
      const resolved = resolveSamplingOpts(rawOpts, config);
      console.log(`# Profile: ${resolved.resolvedProfile.name}`);
      const opts = { ...resolved, runner: rawOpts.runner, retry: rawOpts.retry };
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();

      try {
        const changedFiles = resolveChangedFiles(cwd, opts.changed);
        const mode = parseSamplingMode(opts.strategy);
        const manifest = opts.skipQuarantined
          ? loadQuarantineManifestIfExists({ cwd })
          : null;
        const resolver =
          (mode === "affected" || mode === "hybrid") && changedFiles?.length
            ? await createConfiguredResolver(cwd, config.affected)
            : undefined;
        if (opts.runner === "actrun") {
          const actRunner = new ActrunRunner({
            workflow: config.runner.command,
          });
          if (opts.retry) {
            actRunner.retry();
          } else {
            const result = actRunner.runWithResult();
            // Auto-import results
            const { actrunAdapter } = await import("./adapters/actrun.js");
            const testCases = actrunAdapter.parse(JSON.stringify({
              run_id: result.runId,
              conclusion: result.conclusion,
              headSha: result.headSha,
              headBranch: result.headBranch,
              startedAt: result.startedAt,
              completedAt: result.completedAt,
              status: "completed",
              tasks: result.tasks.map((t) => ({
                id: t.id, kind: "run", status: t.status, code: t.code, shell: "bash",
                stdout_path: t.stdoutPath, stderr_path: t.stderrPath,
              })),
              steps: [],
            }));
            if (testCases.length > 0) {
              const runId = Date.now();
              await store.insertWorkflowRun({
                id: runId,
                repo: `${config.repo.owner}/${config.repo.name}`,
                branch: result.headBranch,
                commitSha: result.headSha,
                event: "actrun-run",
                source: "local",
                status: result.conclusion,
                createdAt: new Date(result.startedAt),
                durationMs: result.durationMs,
              });
              await store.insertTestResults(
                testCases.map((tc) =>
                  toStoredTestResult(tc, {
                    workflowRunId: runId,
                    commitSha: result.headSha,
                    createdAt: new Date(result.startedAt),
                  }),
                ),
              );
              console.log(`Imported ${testCases.length} test results from actrun run ${result.runId}`);
            }
            // Run eval mini-report
            const { runEval, formatEvalReport } = await import("./commands/eval.js");
            const evalReport = await runEval({ store });
            console.log(formatEvalReport(evalReport));
          }
          return;
        }
        const commitSha = resolveCurrentCommitSha(cwd) ?? `local-${Date.now()}`;
        const kpi = await runSamplingKpi({ store });

        // Adaptive percentage adjustment
        const profile = opts.resolvedProfile;
        if (profile.adaptive && opts.percentage != null) {
          const kpiData = await computeKpi(store);
          const insightsData = await runInsights({ store });
          const divergenceRate = insightsData.summary.totalTests > 0
            ? insightsData.summary.ciOnlyCount / insightsData.summary.totalTests
            : null;
          const adaptive = computeAdaptivePercentage(
            {
              falseNegativeRate: kpiData.sampling.falseNegativeRate,
              divergenceRate,
            },
            {
              basePercentage: opts.percentage,
              fnrLow: profile.adaptive_fnr_low,
              fnrHigh: profile.adaptive_fnr_high,
              minPercentage: profile.adaptive_min_percentage,
              step: profile.adaptive_step,
            },
          );
          opts.percentage = adaptive.percentage;
          console.log(`# Adaptive: ${adaptive.reason}`);
        }

        if (profile.max_duration_seconds != null) {
          console.log(`# Time budget: ${profile.max_duration_seconds}s`);
        }

        const runResult = await runTests({
          store,
          runner: createRunner(config.runner),
          mode,
          count: opts.count,
          percentage: opts.percentage,
          resolver,
          changedFiles,
          skipQuarantined: opts.skipQuarantined,
          quarantineManifestEntries: manifest?.entries,
          cwd,
          coFailureDays: opts.coFailureDays,
          holdoutRatio: opts.holdoutRatio,
        });
        console.log(formatSamplingSummary(runResult.samplingSummary, {
          ciPassWhenLocalPassRate: kpi.passSignal.rate,
        }));
        const workflowRunId = Date.now();
        const createdAt = new Date();
        await store.insertWorkflowRun({
          id: workflowRunId,
          repo: `${config.repo.owner}/${config.repo.name}`,
          branch: "local",
          commitSha,
          event: "flaker-local-run",
          source: "local",
          status: runResult.exitCode === 0 ? "success" : "failure",
          createdAt,
          durationMs: runResult.durationMs,
        });
        await store.insertTestResults(
          runResult.results.map((tc) =>
            toStoredTestResult(tc, {
              workflowRunId,
              commitSha,
              createdAt,
            }),
          ),
        );
        // Collect commit_changes for co-failure learning
        if (commitSha && !commitSha.startsWith("local-")) {
          const { collectCommitChanges } = await import("./commands/collect-commit-changes.js");
          await collectCommitChanges(store, cwd, commitSha);
        }
        // Store holdout test results with is_holdout marker
        if (runResult.holdoutResult) {
          await store.insertTestResults(
            runResult.holdoutResult.results.map((tc) =>
              toStoredTestResult(tc, {
                workflowRunId,
                commitSha,
                createdAt,
              }),
            ),
          );
          const holdoutFailures = runResult.holdoutResult.results.filter(
            (r) => r.status === "failed",
          );
          if (holdoutFailures.length > 0) {
            console.log(`\n# Holdout: ${holdoutFailures.length}/${runResult.holdoutTests.length} failures detected (missed by sampling)`);
          }
        }
        await recordSamplingRunFromSummary(store, {
          commitSha,
          commandKind: "run",
          summary: runResult.samplingSummary,
          tests: runResult.sampledTests,
          holdoutTests: runResult.holdoutTests,
          durationMs: runResult.durationMs,
        });
        if (runResult.exitCode !== 0) {
          process.exit(1);
        }
      } finally {
        await store.close();
      }
    },
  );

// --- affected ---
program
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

// --- query ---
program
  .command("check")
  .description("Validate test spec ownership and config drift")
  .option("--json", "Output JSON report")
  .option("--markdown", "Output Markdown report")
  .action(async (opts: { json?: boolean; markdown?: boolean }) => {
    if (opts.json && opts.markdown) {
      console.error("Error: choose either --json or --markdown");
      process.exit(1);
    }

    const cwd = process.cwd();
    const config = loadConfig(cwd);
    const listedTests = await listRunnerTests(cwd, config.runner);
    const discoveredSpecs = discoverTestSpecsForCheck(cwd, config.runner.type);
    const taskDefinitions = loadTaskDefinitionsForCheck({
      cwd,
      resolverName: config.affected.resolver,
      resolverConfig: config.affected.config,
    });

    const report = runConfigCheck({
      listedTests,
      discoveredSpecs,
      taskDefinitions,
    });
    console.log(
      formatConfigCheckReport(report, opts.json ? "json" : "markdown"),
    );
    process.exit(report.errors.length > 0 ? 1 : 0);
  });

// --- report ---
const reportCommand = program
  .command("report")
  .description("Summarize and diff normalized test reports")
  .action(() => {
    reportCommand.outputHelp();
  });

reportCommand
  .command("summarize")
  .description("Summarize a raw adapter report")
  .requiredOption("--adapter <type>", "Adapter type (playwright, junit, vrt-migration, vrt-bench)")
  .requiredOption("--input <file>", "Raw adapter report file")
  .option("--bundle", "Wrap summary with shard metadata for aggregation")
  .option("--shard <name>", "Shard name")
  .option("--module <name>", "Module name")
  .option("--offset <n>", "Shard offset")
  .option("--limit <n>", "Shard limit")
  .option("--matrix <pairs>", "Comma-separated matrix metadata (key=value)")
  .option("--variant <pairs>", "Comma-separated variant metadata (key=value)")
  .option("--meta <pairs>", "Comma-separated extra metadata (key=value)")
  .option("--json", "Output JSON report")
  .option("--markdown", "Output Markdown report")
  .action(
    (opts: {
      adapter: string;
      input: string;
      bundle?: boolean;
      shard?: string;
      module?: string;
      offset?: string;
      limit?: string;
      matrix?: string;
      variant?: string;
      meta?: string;
      json?: boolean;
      markdown?: boolean;
    }) => {
      if (opts.json && opts.markdown) {
        console.error("Error: choose either --json or --markdown");
        process.exit(1);
      }
      if (opts.bundle && opts.markdown) {
        console.error("Error: --bundle cannot be combined with --markdown");
        process.exit(1);
      }

      const summary = runReportSummarize({
        adapter: opts.adapter,
        input: readFileSync(resolve(opts.input), "utf-8"),
      });
      if (opts.bundle) {
        console.log(
          JSON.stringify(
            createReportSummaryArtifact(summary, {
              shard: opts.shard,
              module: opts.module,
              offset: opts.offset ? Number(opts.offset) : undefined,
              limit: opts.limit ? Number(opts.limit) : undefined,
              matrix: parseKeyValuePairs(opts.matrix),
              variant: parseKeyValuePairs(opts.variant),
              extra: parseKeyValuePairs(opts.meta),
            }),
            null,
            2,
          ),
        );
        return;
      }
      console.log(
        formatReportSummary(summary, opts.json ? "json" : "markdown"),
      );
    },
  );

reportCommand
  .command("diff")
  .description("Diff two normalized summaries or raw adapter reports")
  .requiredOption("--base <file>", "Base summary or raw report file")
  .requiredOption("--head <file>", "Head summary or raw report file")
  .option("--adapter <type>", "Adapter type when diffing raw reports")
  .option("--json", "Output JSON report")
  .option("--markdown", "Output Markdown report")
  .action(
    (opts: {
      base: string;
      head: string;
      adapter?: string;
      json?: boolean;
      markdown?: boolean;
    }) => {
      if (opts.json && opts.markdown) {
        console.error("Error: choose either --json or --markdown");
        process.exit(1);
      }

      const baseInput = readFileSync(resolve(opts.base), "utf-8");
      const headInput = readFileSync(resolve(opts.head), "utf-8");
      const base = opts.adapter
        ? runReportSummarize({ adapter: opts.adapter, input: baseInput })
        : parseReportSummary(baseInput);
      const head = opts.adapter
        ? runReportSummarize({ adapter: opts.adapter, input: headInput })
        : parseReportSummary(headInput);
      const diff = runReportDiff({ base, head });

      console.log(formatReportDiff(diff, opts.json ? "json" : "markdown"));
    },
  );

reportCommand
  .command("aggregate <dir>")
  .description("Aggregate shard-aware summary artifacts")
  .option("--json", "Output JSON report")
  .option("--markdown", "Output Markdown report")
  .action((dir: string, opts: { json?: boolean; markdown?: boolean }) => {
    if (opts.json && opts.markdown) {
      console.error("Error: choose either --json or --markdown");
      process.exit(1);
    }

    const aggregate = runReportAggregate({
      summaries: loadReportSummaryArtifactsFromDir(resolve(dir)),
    });
    console.log(
      formatReportAggregate(aggregate, opts.json ? "json" : "markdown"),
    );
  });

// --- query ---
program
  .command("query <sql>")
  .description("Execute a read-only SQL query against the metrics database")
  .action(async (sql: string) => {
    // Reject write operations and dangerous DuckDB functions
    const stripped = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const normalized = stripped.toUpperCase();
    const writePatterns = /^(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|COPY\s|ATTACH|LOAD|INSTALL)/;
    if (writePatterns.test(normalized)) {
      console.error("Error: query command only supports read-only (SELECT/WITH) queries.");
      process.exit(1);
    }
    // Block DuckDB filesystem functions
    const dangerousFns = /\b(READ_CSV_AUTO|READ_CSV|READ_PARQUET|READ_JSON_AUTO|READ_JSON|READ_BLOB|READ_TEXT|WRITE_CSV|HTTPFS)\s*\(/i;
    if (dangerousFns.test(stripped)) {
      console.error("Error: filesystem/network functions are not allowed in query command.");
      process.exit(1);
    }
    const config = loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();

    try {
      const rows = await runQuery(store, sql);
      console.log(formatQueryResult(rows as Record<string, unknown>[]));
    } finally {
      await store.close();
    }
  });

// --- quarantine ---
const quarantineCommand = program
  .command("quarantine")
  .description("Manage quarantined tests")
  .option("--add <suite:testName>", "Add a test to quarantine (suite:testName)")
  .option(
    "--remove <suite:testName>",
    "Remove a test from quarantine (suite:testName)",
  )
  .option("--auto", "Auto-quarantine tests exceeding flaky threshold")
  .action(
    async (opts: { add?: string; remove?: string; auto?: boolean }) => {
      const config = loadConfig(process.cwd());
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();

      try {
        if (opts.add) {
          const [suite, testName] = opts.add.split(":");
          if (!suite || !testName) {
            console.error("Error: --add requires format suite:testName");
            process.exit(1);
          }
          await runQuarantine({
            store,
            action: "add",
            suite,
            testName,
            reason: "manual",
          });
          console.log(`Quarantined ${suite}:${testName}`);
        } else if (opts.remove) {
          const [suite, testName] = opts.remove.split(":");
          if (!suite || !testName) {
            console.error("Error: --remove requires format suite:testName");
            process.exit(1);
          }
          await runQuarantine({ store, action: "remove", suite, testName });
          console.log(`Removed ${suite}:${testName} from quarantine`);
        } else if (opts.auto) {
          await runQuarantine({
            store,
            action: "auto",
            flakyRateThreshold: config.quarantine.flaky_rate_threshold,
            minRuns: config.quarantine.min_runs,
          });
          const quarantined = await store.queryQuarantined();
          console.log(
            `Auto-quarantine complete. ${quarantined.length} test(s) quarantined.`,
          );
          if (quarantined.length > 0) {
            console.log(formatQuarantineTable(quarantined));
          }
        } else {
          const result = await runQuarantine({ store, action: "list" });
          if (result && result.length > 0) {
            console.log(formatQuarantineTable(result));
          } else {
            console.log("No quarantined tests.");
          }
        }
      } finally {
        await store.close();
      }
    },
  );

quarantineCommand
  .command("check")
  .description("Validate the repo-tracked quarantine manifest")
  .option("--manifest <path>", "Override manifest path")
  .action(async (opts: { manifest?: string }) => {
    const cwd = process.cwd();
    const config = loadConfig(cwd);
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();

    try {
      const manifestPath = resolveQuarantineManifestPath({
        cwd,
        manifestPath: opts.manifest,
      });
      if (!manifestPath) {
        console.error("Error: quarantine manifest not found");
        process.exit(1);
      }

      const manifest = loadQuarantineManifest({
        cwd,
        manifestPath,
      });
      const knownTaskIds = await collectKnownQuarantineTaskIds(
        cwd,
        store,
        config.runner,
      );
      const report = validateQuarantineManifest({
        cwd,
        manifest,
        manifestPath,
        knownTaskIds,
      });

      if (report.errors.length > 0) {
        console.error(formatQuarantineManifestReport(report, "markdown"));
        process.exit(1);
      }
      console.log(formatQuarantineManifestReport(report, "markdown"));
    } finally {
      await store.close();
    }
  });

quarantineCommand
  .command("report")
  .description("Render a quarantine manifest report")
  .option("--manifest <path>", "Override manifest path")
  .option("--json", "Output JSON report")
  .option("--markdown", "Output Markdown report")
  .action(async (opts: { manifest?: string; json?: boolean; markdown?: boolean }) => {
    if (opts.json && opts.markdown) {
      console.error("Error: choose either --json or --markdown");
      process.exit(1);
    }

    const cwd = process.cwd();
    const config = loadConfig(cwd);
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();

    try {
      const manifestPath = resolveQuarantineManifestPath({
        cwd,
        manifestPath: opts.manifest,
      });
      if (!manifestPath) {
        console.error("Error: quarantine manifest not found");
        process.exit(1);
      }

      const manifest = loadQuarantineManifest({
        cwd,
        manifestPath,
      });
      const knownTaskIds = await collectKnownQuarantineTaskIds(
        cwd,
        store,
        config.runner,
      );
      const report = validateQuarantineManifest({
        cwd,
        manifest,
        manifestPath,
        knownTaskIds,
      });
      console.log(
        formatQuarantineManifestReport(
          report,
          opts.json ? "json" : "markdown",
        ),
      );
    } finally {
      await store.close();
    }
  });

// --- eval ---
program
  .command("eval")
  .description("Measure whether local sampled runs predict CI")
  .option("--window <days>", "Analysis window in days")
  .option("--json", "Output raw JSON report")
  .option("--markdown", "Output markdown review report")
  .action(async (opts: { window?: string; json?: boolean; markdown?: boolean }) => {
    if (opts.json && opts.markdown) {
      console.error("Cannot use --json and --markdown together");
      process.exit(1);
    }
    const config = loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    const windowDays = opts.window ? Number(opts.window) : config.flaky.window_days;
    await store.initialize();
    try {
      const report = await runEval({ store, windowDays });
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else if (opts.markdown) {
        console.log(formatEvalReport(report, "markdown", { windowDays }));
      } else {
        console.log(formatEvalReport(report));
      }
    } finally {
      await store.close();
    }
  });

// --- reason ---
program
  .command("reason")
  .description("Analyze flaky tests and produce actionable recommendations")
  .option("--window <days>", "Analysis window in days", "30")
  .option("--json", "Output raw JSON report")
  .action(async (opts: { window: string; json?: boolean }) => {
    const config = loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();
    try {
      const report = await runReason({ store, windowDays: Number(opts.window) });
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatReasoningReport(report));
      }
    } finally {
      await store.close();
    }
  });

// --- import ---
program
  .command("import <file>")
  .description("Import a local test report file")
  .option("--adapter <type>", "Adapter type (playwright, junit, vrt-migration, vrt-bench, custom)", "playwright")
  .option("--custom-command <cmd>", "Custom adapter command (required with --adapter custom)")
  .option("--commit <sha>", "Commit SHA")
  .option("--branch <branch>", "Branch name")
  .action(async (file: string, opts: { adapter: string; customCommand?: string; commit?: string; branch?: string }) => {
    const config = loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();
    try {
      const result = await runImport({
        store,
        filePath: resolve(file),
        adapterType: opts.adapter,
        customCommand: opts.customCommand,
        commitSha: opts.commit,
        branch: opts.branch,
        repo: `${config.repo.owner}/${config.repo.name}`,
      });
      console.log(`Imported ${result.testsImported} test results`);
    } finally {
      await store.close();
    }
  });

// --- bisect ---
program
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

// --- collect-local ---
program
  .command("collect-local")
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
        const { runEval, formatEvalReport } = await import("./commands/eval.js");
        const evalReport = await runEval({ store });
        console.log(formatEvalReport(evalReport));
      }
    } finally {
      await store.close();
    }
  });

// --- self-eval ---
program
  .command("self-eval")
  .description("Run self-evaluation scenarios to validate recommendation logic")
  .option("--json", "Output raw JSON report")
  .action(async (opts: { json?: boolean }) => {
    const createStore = async () => {
      const s = new DuckDBStore(":memory:");
      await s.initialize();
      return s;
    };
    const report = await runSelfEval({ createStore });
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatSelfEvalReport(report));
    }
    process.exit(report.overallScore >= 80 ? 0 : 1);
  });

// --- eval-fixture ---
program
  .command("eval-fixture")
  .description("Evaluate sampling strategies with synthetic data")
  .option("--tests <n>", "Number of tests", "100")
  .option("--commits <n>", "Number of commits", "50")
  .option("--flaky-rate <n>", "Flaky rate (0-1)", "0.1")
  .option("--co-failure-strength <n>", "Co-failure correlation (0-1)", "0.8")
  .option("--files-per-commit <n>", "Files changed per commit", "2")
  .option("--tests-per-file <n>", "Tests per source file", "5")
  .option("--sample-percentage <n>", "Sample percentage", "20")
  .option("--seed <n>", "Random seed", "42")
  .option("--sweep", "Sweep co-failure strength 0.0-1.0")
  .option("--multi-sweep", "Multi-parameter sweep (testCount × flakyRate × coFailure × sample%)")
  .action(async (opts) => {
    // Validate inputs
    const testCount = parseInt(opts.tests, 10);
    const commitCount = parseInt(opts.commits, 10);
    const flakyRate = parseFloat(opts.flakyRate);
    const coFailureStrength = parseFloat(opts.coFailureStrength);
    const filesPerCommit = parseInt(opts.filesPerCommit, 10);
    const testsPerFile = parseInt(opts.testsPerFile, 10);
    const samplePercentage = parseInt(opts.samplePercentage, 10);
    const seed = parseInt(opts.seed, 10);

    const errors: string[] = [];
    if (!Number.isFinite(testCount) || testCount < 1) errors.push("--tests must be a positive integer");
    if (!Number.isFinite(commitCount) || commitCount < 1) errors.push("--commits must be a positive integer");
    if (!Number.isFinite(flakyRate) || flakyRate < 0 || flakyRate > 1) errors.push("--flaky-rate must be between 0 and 1");
    if (!Number.isFinite(coFailureStrength) || coFailureStrength < 0 || coFailureStrength > 1) errors.push("--co-failure-strength must be between 0 and 1");
    if (!Number.isFinite(filesPerCommit) || filesPerCommit < 1) errors.push("--files-per-commit must be a positive integer");
    if (!Number.isFinite(testsPerFile) || testsPerFile < 1) errors.push("--tests-per-file must be a positive integer");
    if (!Number.isFinite(samplePercentage) || samplePercentage < 1 || samplePercentage > 100) errors.push("--sample-percentage must be between 1 and 100");
    if (!Number.isFinite(seed)) errors.push("--seed must be an integer");
    if (errors.length > 0) {
      console.error(errors.join("\n"));
      process.exit(1);
    }

    const baseConfig = { testCount, commitCount, flakyRate, coFailureStrength, filesPerCommit, testsPerFile, samplePercentage, seed };

    if (opts.multiSweep) {
      const { runSweep } = await import("./eval/fixture-evaluator.js");
      const sweepResults = await runSweep(
        baseConfig,
        {
          testCounts: [50, 200, 500],
          flakyRates: [0.05, 0.15],
          coFailureStrengths: [0.3, 0.6, 0.9],
          samplePercentages: [10, 20, 40],
        },
        async () => {
          const s = new DuckDBStore(":memory:");
          await s.initialize();
          return { store: s, close: () => s.close() };
        },
      );
      console.log(formatMultiSweepReport(sweepResults));
    } else if (opts.sweep) {
      const strengths = [0.0, 0.25, 0.5, 0.75, 1.0];
      const reports = [];
      for (const strength of strengths) {
        const config = { ...baseConfig, coFailureStrength: strength };
        const store = new DuckDBStore(":memory:");
        await store.initialize();
        const fixture = generateFixture(config);
        await loadFixtureIntoStore(store, fixture);
        const results = await evaluateFixture(store, fixture);
        reports.push({ config, results });
        await store.close();
      }
      console.log(formatSweepReport(reports));
    } else {
      const store = new DuckDBStore(":memory:");
      await store.initialize();
      const fixture = generateFixture(baseConfig);
      await loadFixtureIntoStore(store, fixture);
      const results = await evaluateFixture(store, fixture);
      console.log(formatEvalFixtureReport({ config: baseConfig, results }));
      await store.close();
    }
  });

// --- tune ---
program
  .command("tune")
  .description("Auto-tune co-failure alpha parameter using historical data")
  .option("--window <days>", "Analysis window in days", "90")
  .option("--sample-percentage <n>", "Sample percentage for evaluation", "20")
  .option("--dry-run", "Show results without saving")
  .action(async (opts) => {
    const config = loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();

    try {
      const windowDays = parseInt(opts.window, 10);
      const samplePercentage = parseInt(opts.samplePercentage, 10);

      // Get recent commits with changed files and test results
      const commits = await store.raw<{
        commit_sha: string;
      }>(`SELECT DISTINCT commit_sha FROM test_results
          WHERE created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(windowDays)} || ' days')
          ORDER BY commit_sha`);

      if (commits.length < 5) {
        console.log("Not enough data for tuning (need at least 5 commits with test results)");
        return;
      }

      const changedFilesPerCommit = new Map<string, string[]>();
      const groundTruth = new Map<string, Set<string>>();

      for (const { commit_sha } of commits) {
        const changes = await store.raw<{ file_path: string }>(
          `SELECT file_path FROM commit_changes WHERE commit_sha = ?`,
          [commit_sha],
        );
        if (changes.length === 0) continue;
        changedFilesPerCommit.set(commit_sha, changes.map((c) => c.file_path));

        const failures = await store.raw<{ suite: string }>(
          `SELECT DISTINCT suite FROM test_results
           WHERE commit_sha = ? AND status IN ('failed', 'flaky')`,
          [commit_sha],
        );
        groundTruth.set(commit_sha, new Set(failures.map((f) => f.suite)));
      }

      if (changedFilesPerCommit.size < 3) {
        console.log("Not enough commits with change data for tuning");
        return;
      }

      const allSuites = await store.raw<{ suite: string }>(
        `SELECT DISTINCT suite FROM test_results`,
      );
      const sampleCount = Math.round(allSuites.length * (samplePercentage / 100));

      const { tuneAlpha, findBestAlpha, formatTuningReport, saveTuningConfig } =
        await import("./eval/alpha-tuner.js");

      const results = await tuneAlpha({
        store,
        changedFilesPerCommit,
        groundTruth,
        allTestSuites: allSuites.map((s) => s.suite),
        sampleCount,
      });

      console.log(formatTuningReport(results));

      if (!opts.dryRun) {
        const best = findBestAlpha(results);
        saveTuningConfig(config.storage.path, { alpha: best.alpha });
        console.log(`\nSaved alpha=${best.alpha} to .flaker/models/tuning.json`);
      }
    } finally {
      await store.close();
    }
  });

// --- train ---
program
  .command("train")
  .description("Train a GBDT model from historical test results")
  .option("--num-trees <n>", "Number of trees (default: 15)")
  .option("--learning-rate <rate>", "Learning rate (default: 0.2)")
  .option("--window-days <days>", "Training data window in days (default: 90)")
  .option("--output <path>", "Output model path (default: .flaker/models/gbdt.json)")
  .action(
    async (opts: { numTrees?: string; learningRate?: string; windowDays?: string; output?: string }) => {
      const config = loadConfig(process.cwd());
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();

      try {
        const { trainModel, formatTrainResult } = await import("./commands/train.js");
        const result = await trainModel({
          store,
          storagePath: config.storage.path,
          numTrees: opts.numTrees ? parseInt(opts.numTrees, 10) : undefined,
          learningRate: opts.learningRate ? parseFloat(opts.learningRate) : undefined,
          windowDays: opts.windowDays ? parseInt(opts.windowDays, 10) : undefined,
          outputPath: opts.output,
        });
        console.log(formatTrainResult(result));
      } finally {
        await store.close();
      }
    },
  );

// --- kpi ---
program
  .command("kpi")
  .description("Show KPI dashboard — sampling effectiveness, flaky tracking, data quality")
  .option("--window-days <days>", "Analysis window in days", "30")
  .option("--json", "Output as JSON")
  .action(async (opts: { windowDays: string; json?: boolean }) => {
    const config = loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();
    try {
      const { computeKpi, formatKpi } = await import("./commands/kpi.js");
      const kpi = await computeKpi(store, { windowDays: parseInt(opts.windowDays, 10) });
      if (opts.json) {
        console.log(JSON.stringify(kpi, null, 2));
      } else {
        console.log(formatKpi(kpi));
      }
    } finally {
      await store.close();
    }
  });

// --- insights ---
program
  .command("insights")
  .description("Compare CI vs local failure patterns to identify environment-specific issues")
  .option("--window-days <days>", "Analysis window in days", "90")
  .option("--top <n>", "Number of tests to show per category", "20")
  .action(async (opts: { windowDays: string; top: string }) => {
    const config = loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();
    try {
      const { runInsights, formatInsights } = await import("./commands/insights.js");
      const result = await runInsights({
        store,
        windowDays: parseInt(opts.windowDays, 10),
        top: parseInt(opts.top, 10),
      });
      console.log(formatInsights(result));
    } finally {
      await store.close();
    }
  });

// --- calibrate ---
program
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
      const { analyzeProject, recommendSampling, formatCalibrationReport, buildExplainContext, queryTopTests } = await import("./commands/calibrate.js");

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

// --- context ---
program
  .command("context")
  .description("Show environment data and strategy characteristics for decision-making")
  .option("--json", "Output as JSON for programmatic consumption")
  .action(async (opts) => {
    const config = loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();

    try {
      const hasResolver = !!(config as any).affected;
      const { buildContext, formatContext } = await import("./commands/context.js");
      const ctx = await buildContext(store, {
        storagePath: config.storage.path,
        resolverConfigured: hasResolver,
      });

      if (opts.json) {
        console.log(JSON.stringify(ctx, null, 2));
      } else {
        console.log(formatContext(ctx));
      }
    } finally {
      await store.close();
    }
  });

// --- doctor ---
program
  .command("doctor")
  .description("Check local flaker runtime requirements")
  .action(async () => {
    const report = await runDoctor(process.cwd(), {
      createStore: () => new DuckDBStore(":memory:"),
    });
    console.log(formatDoctorReport(report));
    process.exit(report.ok ? 0 : 1);
  });

  appendExamplesToCommand(program.commands.find((command) => command.name() === "collect"), [
    "flaker collect --last 30",
    "flaker collect --branch main --last 14",
    "flaker collect --json --output .artifacts/collect.json --fail-on-errors",
  ]);
  appendExamplesToCommand(program.commands.find((command) => command.name() === "flaky"), [
    "flaker flaky --top 20",
    "flaker flaky --true-flaky",
    "flaker flaky --trend --test \"should redirect\"",
  ]);
  appendExamplesToCommand(program.commands.find((command) => command.name() === "sample"), [
    "flaker sample",
    "flaker sample --strategy hybrid --count 25",
    "flaker sample --changed src/foo.ts",
  ]);
  appendHelpText(
    program.commands.find((command) => command.name() === "sample") as Command,
    "\nStrategy and percentage are read from flaker.toml [sampling] if present.\n" +
    "Changed files are auto-detected from git diff.\n" +
    "\nStrategies:\n" +
    "  random    Uniform random\n" +
    "  weighted  Prioritize by flaky rate + co-failure (default without config)\n" +
    "  hybrid    affected + co-failure + weighted fill (best with resolver)\n" +
    "  gbdt      ML model ranking (requires `flaker train` first)\n",
  );
  appendExamplesToCommand(program.commands.find((command) => command.name() === "run"), [
    "flaker run",
    "flaker run --strategy hybrid",
    "flaker run --runner actrun",
  ]);
  appendHelpText(
    program.commands.find((command) => command.name() === "run") as Command,
    "\nNo flags needed if flaker.toml has [sampling] config (set by `flaker calibrate`).\n" +
    "Changed files are auto-detected from git diff.\n" +
    "Results are saved to the database for learning.\n",
  );
  appendExamplesToCommand(program.commands.find((command) => command.name() === "affected"), [
    "flaker affected src/foo.ts src/bar.ts",
    "flaker affected --changed src/foo.ts,src/bar.ts",
    "flaker affected --json --changed src/foo.ts",
  ]);
  appendExamplesToCommand(program.commands.find((command) => command.name() === "check"), [
    "flaker check",
    "flaker check --json",
  ]);
  appendExamplesToCommand(program.commands.find((command) => command.name() === "quarantine"), [
    "flaker quarantine",
    "flaker quarantine --auto",
    "flaker quarantine --add \"tests/login.spec.ts:should redirect\"",
  ]);
  appendExamplesToCommand(program.commands.find((command) => command.name() === "eval"), [
    "flaker eval",
    "flaker eval --json",
    "flaker eval --markdown --window 7",
  ]);
  appendExamplesToCommand(program.commands.find((command) => command.name() === "reason"), [
    "flaker reason",
    "flaker reason --window 7",
    "flaker reason --json",
  ]);
  appendExamplesToCommand(program.commands.find((command) => command.name() === "import"), [
    "flaker import report.json --adapter playwright --commit $(git rev-parse HEAD)",
    "flaker import results.xml --adapter junit",
    "flaker import report.json --adapter custom --custom-command \"node ./adapter.js\"",
  ]);
  appendExamplesToCommand(program.commands.find((command) => command.name() === "bisect"), [
    "flaker bisect --test \"should redirect\"",
    "flaker bisect --test \"should redirect\" --suite tests/login.spec.ts",
  ]);
  appendExamplesToCommand(program.commands.find((command) => command.name() === "collect-local"), [
    "flaker collect-local",
    "flaker collect-local --last 10",
  ]);
  appendExamplesToCommand(program.commands.find((command) => command.name() === "self-eval"), [
    "flaker self-eval",
    "flaker self-eval --json",
  ]);
  appendExamplesToCommand(program.commands.find((command) => command.name() === "doctor"), [
    "flaker doctor",
  ]);
  appendExamplesToCommand(program.commands.find((command) => command.name() === "context"), [
    "flaker context",
    "flaker context --json",
  ]);
  appendExamplesToCommand(program.commands.find((command) => command.name() === "eval-fixture"), [
    "flaker eval-fixture",
    "flaker eval-fixture --sweep",
  ]);
  appendHelpText(
    program.commands.find((command) => command.name() === "eval-fixture") as Command,
    `\nRuns synthetic benchmarks comparing sampling strategies. No config needed.\nOutput: a comparison table showing recall, precision, F1, and efficiency.\nUse --sweep to compare across different co-failure correlation strengths.\n`,
  );

  return program;
}

const program = createProgram();

if (isDirectCliExecution()) {
  if (process.argv.length <= 2) {
    program.outputHelp();
    process.exit(0);
  }

  program.parseAsync(process.argv).catch((err) => {
    if (err instanceof Error) {
      if (err.message.includes("Config file not found") || err.message.includes("flaker.toml")) {
        console.error(`Error: ${err.message}`);
        console.error(`Run 'flaker init' to create one.`);
        process.exit(1);
      }
      if (err.message.includes("DuckDB") || err.message.includes("duckdb")) {
        console.error(`Error: ${err.message}`);
        console.error(`Run 'flaker doctor' to check your setup.`);
        process.exit(1);
      }
    }
    // Unknown error
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  });
}
