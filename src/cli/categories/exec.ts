import { resolve } from "node:path";
import type { Command } from "commander";
import {
  loadConfig,
  resolveActrunWorkflowPath,
  type FlakerConfig,
} from "../config.js";
import {
  formatSamplingSummary,
} from "../commands/exec/plan.js";
import { recordSamplingRunFromSummary } from "../commands/sampling-run.js";
import { runTests, formatExplainTable } from "../commands/exec/run.js";
import {
  runAffected,
  formatAffectedReport,
} from "../commands/exec/affected.js";
import {
  parseSampleCount,
  parseSamplePercentage,
  parseSamplingMode,
} from "../commands/exec/sampling-options.js";
import { ActrunRunner } from "../runners/actrun.js";
import { DuckDBStore } from "../storage/duckdb.js";
import { createRunner } from "../runners/index.js";
import { toStoredTestResult } from "../storage/test-result-mapper.js";
import { createResolver } from "../resolvers/index.js";
import { resolveCurrentCommitSha, detectChangedFiles } from "../core/git.js";
import { loadQuarantineManifestIfExists } from "../quarantine-manifest.js";
import {
  detectProfileName,
  resolveProfile,
  computeAdaptivePercentage,
  resolveFallbackSamplingMode,
  type ResolvedProfile,
} from "../profile.js";
import { computeKpi } from "../commands/analyze/kpi.js";
import { runInsights } from "../commands/analyze/insights.js";
import { runSamplingKpi } from "../commands/analyze/eval.js";

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
    .option("--profile <name>", "Execution profile: scheduled, ci, local (auto-detected if omitted)")
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

function parseChangedFiles(input?: string): string[] | undefined {
  const files = input
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return files && files.length > 0 ? files : undefined;
}

/** Auto-detect changed files if not explicitly provided. */
function resolveChangedFiles(cwd: string, explicit?: string): string[] | undefined {
  const parsed = parseChangedFiles(explicit);
  if (parsed) return parsed;
  // Auto-detect from git
  const detected = detectChangedFiles(cwd);
  return detected.length > 0 ? detected : undefined;
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

export function registerExecCommands(program: Command): void {
  const exec = program
    .command("exec")
    .description("Test selection and execution");

  addSamplingOptions(
    exec
      .command("run")
      .description("Select and run tests (auto-detects changed files and strategy from config)")
      .option("--runner <runner>", "Runner type: direct or actrun", "direct")
      .option("--retry", "Retry failed tests (actrun only)")
      .option("--dry-run", "Select tests but do not execute them")
      .option("--explain", "Print per-test selection tier, score, and reason"),
  ).action(
    async (rawOpts: SamplingCliOpts & { runner: string; retry?: boolean; dryRun?: boolean; explain?: boolean }) => {
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
            workflow: resolveActrunWorkflowPath(config),
            job: config.runner.actrun?.job,
            local: config.runner.actrun?.local,
            trust: config.runner.actrun?.trust,
          });
          if (opts.retry) {
            actRunner.retry();
          } else {
            const result = actRunner.runWithResult();
            // Auto-import results
            const { actrunAdapter } = await import("../adapters/actrun.js");
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
            const { runEval, formatEvalReport } = await import("../commands/analyze/eval.js");
            const evalReport = await runEval({ store });
            console.log(formatEvalReport(evalReport));
          }
          return;
        }
        const commitSha = resolveCurrentCommitSha(cwd) ?? `local-${Date.now()}`;
        const kpi = await runSamplingKpi({ store });
        const fallbackMode = resolveFallbackSamplingMode(opts.resolvedProfile);

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
          fallbackMode,
          count: opts.count,
          percentage: opts.percentage,
          resolver,
          changedFiles,
          skipQuarantined: opts.skipQuarantined,
          quarantineManifestEntries: manifest?.entries,
          cwd,
          coFailureDays: opts.coFailureDays,
          holdoutRatio: opts.holdoutRatio,
          dryRun: rawOpts.dryRun,
          explain: rawOpts.explain,
        });
        console.log(formatSamplingSummary(runResult.samplingSummary, {
          ciPassWhenLocalPassRate: kpi.passSignal.rate,
        }));
        if (rawOpts.explain) {
          console.log(formatExplainTable(runResult.sampledTests, runResult.samplingSummary));
        }
        if (rawOpts.dryRun) {
          // runTests already branched on dryRun and returned without executing
          return;
        }
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
          const { collectCommitChanges } = await import("../commands/collect/commit-changes.js");
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
          id: workflowRunId,
          commitSha,
          commandKind: "run",
          summary: runResult.samplingSummary,
          tests: runResult.sampledTests,
          holdoutTests: runResult.holdoutTests,
          durationMs: runResult.durationMs,
        });
        if (config.storage.path) {
          const { exportRunParquet } = await import("../commands/export-parquet.js");
          await exportRunParquet(store, workflowRunId, config.storage.path);
        }
        if (runResult.exitCode !== 0) {
          process.exit(1);
        }
      } finally {
        await store.close();
      }
    },
  );

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
