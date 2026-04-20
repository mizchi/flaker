import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { DuckDBStore } from "../storage/duckdb.js";
import { runSelfEval, formatSelfEvalReport } from "../commands/dev/self-eval.js";
import { loadCore } from "../core/loader.js";
import { loadFixtureIntoStore } from "../eval/fixture-loader.js";
import { evaluateFixture } from "../eval/fixture-evaluator.js";
import { formatEvalFixtureReport, formatSweepReport, formatMultiSweepReport } from "../eval/fixture-report.js";

export function registerDevCommands(program: Command): void {
  const dev = program
    .command("dev")
    .description("Model training and benchmarks");

  dev
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
          const { trainModel, formatTrainResult } = await import("../commands/dev/train.js");
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

  dev
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
          await import("../eval/alpha-tuner.js");

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

  dev
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

  dev
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

      const baseConfig = {
        test_count: testCount,
        commit_count: commitCount,
        flaky_rate: flakyRate,
        co_failure_strength: coFailureStrength,
        files_per_commit: filesPerCommit,
        tests_per_file: testsPerFile,
        sample_percentage: samplePercentage,
        seed,
      };

      const core = await loadCore();

      if (opts.multiSweep) {
        const { runSweep } = await import("../eval/fixture-evaluator.js");
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
          const config = { ...baseConfig, co_failure_strength: strength };
          const store = new DuckDBStore(":memory:");
          await store.initialize();
          const fixture = core.generateFixture(config);
          await loadFixtureIntoStore(store, fixture);
          const results = await evaluateFixture(store, fixture);
          reports.push({ config, results });
          await store.close();
        }
        console.log(formatSweepReport(reports));
      } else {
        const store = new DuckDBStore(":memory:");
        await store.initialize();
        const fixture = core.generateFixture(baseConfig);
        await loadFixtureIntoStore(store, fixture);
        const results = await evaluateFixture(store, fixture);
        console.log(formatEvalFixtureReport({ config: baseConfig, results }));
        await store.close();
      }
    });

  dev
    .command("eval-co-failure")
    .description("Analyze co-failure data across different time windows")
    .option("--windows <list>", "Comma-separated window sizes in days", "7,14,30,60,90,180")
    .option("--min-co-runs <n>", "Minimum co-runs threshold", "3")
    .option("--json", "Output JSON report")
    .action(async (opts: { windows?: string; minCoRuns?: string; json?: boolean }) => {
      const config = loadConfig(process.cwd());
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();
      try {
        const { analyzeCoFailureWindows, formatCoFailureWindowReport } = await import("../commands/dev/eval-co-failure.js");
        const windows = opts.windows?.split(",").map((w) => parseInt(w.trim(), 10));
        const minCoRuns = parseInt(opts.minCoRuns ?? "3", 10);
        const report = await analyzeCoFailureWindows(store, windows, minCoRuns);
        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(formatCoFailureWindowReport(report));
        }
      } finally {
        await store.close();
      }
    });

  dev
    .command("kpi")
    .description("Raw KPI JSON snapshot (maintainer tool for self-host CI)")
    .option("--window-days <days>", "Analysis window in days", "30")
    .option("--output <path>", "Write JSON to a file instead of stdout")
    .action(async (opts: { windowDays?: string; output?: string }) => {
      const config = loadConfig(process.cwd());
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();
      try {
        const { computeKpi } = await import("../commands/analyze/kpi.js");
        const kpi = await computeKpi(store, {
          windowDays: opts.windowDays ? parseInt(opts.windowDays, 10) : undefined,
        });
        const json = JSON.stringify(kpi, null, 2);
        if (opts.output) {
          const { writeFileSync } = await import("node:fs");
          writeFileSync(resolve(process.cwd(), opts.output), json, "utf8");
        } else {
          console.log(json);
        }
      } finally {
        await store.close();
      }
    });

  dev
    .command("eval")
    .description("Raw eval report JSON snapshot (maintainer tool for self-host CI)")
    .option("--window-days <days>", "Analysis window in days", "30")
    .option("--output <path>", "Write JSON to a file instead of stdout")
    .action(async (opts: { windowDays?: string; output?: string }) => {
      const config = loadConfig(process.cwd());
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();
      try {
        const { runEval } = await import("../commands/analyze/eval.js");
        const report = await runEval({
          store,
          windowDays: opts.windowDays ? parseInt(opts.windowDays, 10) : undefined,
        });
        const json = JSON.stringify(report, null, 2);
        if (opts.output) {
          const { writeFileSync } = await import("node:fs");
          writeFileSync(resolve(process.cwd(), opts.output), json, "utf8");
        } else {
          console.log(json);
        }
      } finally {
        await store.close();
      }
    });

  dev
    .command("test-key")
    .description("Debug test key generation")
    .option("--suite <suite>", "Test suite name")
    .option("--test-name <name>", "Test name")
    .option("--task-id <id>", "Task ID")
    .option("--filter <filter>", "Filter")
    .option("--test-id <id>", "Explicit test ID (overrides generation)")
    .action(async (opts: { suite?: string; testName?: string; taskId?: string; filter?: string; testId?: string }) => {
      const { createListedTestKey, createMetaKey } = await import("../commands/dev/test-key.js");
      if (!opts.suite && !opts.testId) {
        console.error("Provide --suite (and optionally --test-name) or --test-id");
        process.exit(1);
      }
      const listedKey = createListedTestKey({
        suite: opts.suite ?? "",
        testName: opts.testName ?? "",
        taskId: opts.taskId,
        filter: opts.filter,
        testId: opts.testId,
      });
      const metaKey = createMetaKey({
        suite: opts.suite ?? "",
        test_name: opts.testName ?? "",
        task_id: opts.taskId,
        filter: opts.filter,
        test_id: opts.testId,
      });
      console.log(`Listed key: ${listedKey}`);
      console.log(`Meta key:   ${metaKey}`);
    });
}
