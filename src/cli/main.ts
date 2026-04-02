#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { Octokit } from "@octokit/rest";
import { loadConfig } from "./config.js";
import { runInit } from "./commands/init.js";
import {
  collectWorkflowRuns,
  formatCollectSummary,
  resolveCollectExitCode,
  writeCollectSummary,
  type GitHubClient,
} from "./commands/collect.js";
import { runFlaky, formatFlakyTable, runFlakyTrend, formatFlakyTrend, runTrueFlaky, formatTrueFlakyTable } from "./commands/flaky.js";
import { runSample } from "./commands/sample.js";
import { runTests } from "./commands/run.js";
import {
  parseSampleCount,
  parseSamplePercentage,
  parseSamplingMode,
} from "./commands/sampling-options.js";
import { ActrunRunner } from "./runners/actrun.js";
import { runBisect } from "./commands/bisect.js";
import { runImport } from "./commands/import.js";
import { runCollectLocal } from "./commands/collect-local.js";
import { runQuery, formatQueryResult } from "./commands/query.js";
import {
  runQuarantine,
  formatQuarantineTable,
} from "./commands/quarantine.js";
import { runEval, formatEvalReport } from "./commands/eval.js";
import { runReason, formatReasoningReport } from "./commands/reason.js";
import { runSelfEval, formatSelfEvalReport } from "./commands/self-eval.js";
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
import {
  formatQuarantineManifestReport,
  loadQuarantineManifest,
  loadQuarantineManifestIfExists,
  resolveQuarantineManifestPath,
  validateQuarantineManifest,
} from "./quarantine-manifest.js";

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

program
  .name("flaker")
  .description("CI metrics collection and analysis tool")
  .version("0.1.0");

// --- init ---
program
  .command("init")
  .description("Initialize flaker configuration")
  .requiredOption("--owner <owner>", "Repository owner")
  .requiredOption("--name <name>", "Repository name")
  .action((opts: { owner: string; name: string }) => {
    runInit(process.cwd(), opts);
    console.log("Initialized flaker.toml");
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
    };

    try {
      const result = await collectWorkflowRuns({
        store,
        github,
        repo: `${owner}/${repo}`,
        adapterType: config.adapter.type,
        artifactName: config.adapter.artifact_name,
        customCommand: config.adapter.command,
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
  .description("Show flaky test statistics")
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
program
  .command("sample")
  .description("Sample tests for selective execution")
  .option("--strategy <s>", "Sampling strategy: random, weighted, affected, hybrid", "random")
  .option("--count <n>", "Number of tests to sample")
  .option("--percentage <n>", "Percentage of tests to sample")
  .option("--skip-quarantined", "Exclude quarantined tests")
  .option("--changed <files>", "Comma-separated list of changed files (for affected/hybrid)")
  .action(
    async (opts: { strategy: string; count?: string; percentage?: string; skipQuarantined?: boolean; changed?: string }) => {
      const config = loadConfig(process.cwd());
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();

      try {
        const changedFiles = parseChangedFiles(opts.changed);
        const mode = parseSamplingMode(opts.strategy);
        const manifest = opts.skipQuarantined
          ? loadQuarantineManifestIfExists({ cwd: process.cwd() })
          : null;
        const listedTests = await listRunnerTests(process.cwd(), config.runner);

        // Create resolver from config for affected/hybrid
        let resolver;
        if ((mode === "affected" || mode === "hybrid") && changedFiles?.length) {
          resolver = await createConfiguredResolver(process.cwd(), config.affected);
        }

        const sampled = await runSample({
          store,
          mode,
          count: parseSampleCount(opts.count),
          percentage: parseSamplePercentage(opts.percentage),
          skipQuarantined: opts.skipQuarantined,
          resolver,
          changedFiles,
          quarantineManifestEntries: manifest?.entries,
          listedTests,
        });
        for (const t of sampled) {
          console.log(`${t.suite} > ${t.test_name}`);
        }
      } finally {
        await store.close();
      }
    },
  );

// --- run ---
program
  .command("run")
  .description("Sample and run tests")
  .option("--strategy <s>", "Sampling strategy: random, weighted, affected, hybrid", "random")
  .option("--count <n>", "Number of tests to run")
  .option("--percentage <n>", "Percentage of tests to run")
  .option("--changed <files>", "Comma-separated list of changed files (for affected/hybrid)")
  .option("--runner <runner>", "Runner type: direct or actrun", "direct")
  .option("--retry", "Retry failed tests (actrun only)")
  .option("--skip-quarantined", "Exclude quarantined tests")
  .action(
    async (opts: { strategy: string; count?: string; percentage?: string; changed?: string; runner: string; retry?: boolean; skipQuarantined?: boolean }) => {
      const cwd = process.cwd();
      const config = loadConfig(cwd);
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();

      try {
        const changedFiles = parseChangedFiles(opts.changed);
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
        const runResult = await runTests({
          store,
          runner: createRunner(config.runner),
          mode,
          count: parseSampleCount(opts.count),
          percentage: parseSamplePercentage(opts.percentage),
          resolver,
          changedFiles,
          skipQuarantined: opts.skipQuarantined,
          quarantineManifestEntries: manifest?.entries,
          cwd,
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
  .description("Summarize and diff normalized test reports");

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
  .description("Execute a SQL query against the metrics database")
  .action(async (sql: string) => {
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
  .description("Evaluate test suite health and flaker effectiveness")
  .option("--json", "Output raw JSON report")
  .action(async (opts: { json?: boolean }) => {
    const config = loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();
    try {
      const report = await runEval({ store, windowDays: config.flaky.window_days });
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
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

program.parse();
