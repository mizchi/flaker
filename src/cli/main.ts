#!/usr/bin/env node
import { resolve } from "node:path";
import { Command } from "commander";
import { Octokit } from "@octokit/rest";
import { loadConfig } from "./config.js";
import { runInit } from "./commands/init.js";
import {
  collectWorkflowRuns,
  type GitHubClient,
} from "./commands/collect.js";
import { runFlaky, formatFlakyTable, runFlakyTrend, formatFlakyTrend, runTrueFlaky, formatTrueFlakyTable } from "./commands/flaky.js";
import { runSample } from "./commands/sample.js";
import { runTests } from "./commands/run.js";
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
import { DuckDBStore } from "./storage/duckdb.js";

const program = new Command();

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
  .action(async (opts: { last: string; branch?: string }) => {
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
        return response.data;
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
      });
      console.log(
        `Collected ${result.runsCollected} runs, ${result.testsCollected} test results`,
      );
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
  .option("--strategy <s>", "Sampling strategy: random or weighted", "random")
  .option("--count <n>", "Number of tests to sample")
  .option("--percentage <n>", "Percentage of tests to sample")
  .option("--skip-quarantined", "Exclude quarantined tests")
  .action(
    async (opts: { strategy: string; count?: string; percentage?: string; skipQuarantined?: boolean }) => {
      const config = loadConfig(process.cwd());
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();

      try {
        const sampled = await runSample({
          store,
          mode: opts.strategy as "random" | "weighted",
          count: opts.count ? Number(opts.count) : undefined,
          percentage: opts.percentage ? Number(opts.percentage) : undefined,
          skipQuarantined: opts.skipQuarantined,
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
  .option("--strategy <s>", "Sampling strategy: random or weighted", "random")
  .option("--count <n>", "Number of tests to run")
  .option("--percentage <n>", "Percentage of tests to run")
  .option("--runner <runner>", "Runner type: direct or actrun", "direct")
  .option("--retry", "Retry failed tests (actrun only)")
  .option("--skip-quarantined", "Exclude quarantined tests")
  .action(
    async (opts: { strategy: string; count?: string; percentage?: string; runner: string; retry?: boolean; skipQuarantined?: boolean }) => {
      const config = loadConfig(process.cwd());
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();

      try {
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
              await store.insertTestResults(testCases.map((tc) => ({
                workflowRunId: runId,
                suite: tc.suite,
                testName: tc.testName,
                status: tc.status,
                durationMs: tc.durationMs,
                retryCount: tc.retryCount,
                errorMessage: tc.errorMessage ?? null,
                commitSha: result.headSha,
                variant: tc.variant ?? null,
                createdAt: new Date(result.startedAt),
              })));
              console.log(`Imported ${testCases.length} test results from actrun run ${result.runId}`);
            }
            // Run eval mini-report
            const { runEval, formatEvalReport } = await import("./commands/eval.js");
            const evalReport = await runEval({ store });
            console.log(formatEvalReport(evalReport));
          }
          return;
        }
        await runTests({
          store,
          command: config.runner.command,
          mode: opts.strategy as "random" | "weighted",
          count: opts.count ? Number(opts.count) : undefined,
          percentage: opts.percentage ? Number(opts.percentage) : undefined,
          skipQuarantined: opts.skipQuarantined,
        });
      } finally {
        await store.close();
      }
    },
  );

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
program
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

// --- import ---
program
  .command("import <file>")
  .description("Import a local test report file")
  .option("--adapter <type>", "Adapter type (playwright, junit)", "playwright")
  .option("--commit <sha>", "Commit SHA")
  .option("--branch <branch>", "Branch name")
  .action(async (file: string, opts: { adapter: string; commit?: string; branch?: string }) => {
    const config = loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();
    try {
      const result = await runImport({
        store,
        filePath: resolve(file),
        adapterType: opts.adapter,
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

program.parse();
