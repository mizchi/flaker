import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { DuckDBStore } from "../storage/duckdb.js";
import {
  runFlaky,
  formatFlakyTable,
  runFlakyTrend,
  formatFlakyTrend,
  runTrueFlaky,
  formatTrueFlakyTable,
} from "../commands/analyze/flaky.js";
import { runReason, formatReasoningReport } from "../commands/analyze/reason.js";
import { runInsights } from "../commands/analyze/insights.js";
import {
  runEval,
  renderEvalReport,
  runSamplingKpi,
  writeEvalReport,
} from "../commands/analyze/eval.js";
import { runQuery, formatQueryResult } from "../commands/analyze/query.js";

export async function analyzeKpiAction(opts: { windowDays: string; json?: boolean }): Promise<void> {
  const config = loadConfig(process.cwd());
  const store = new DuckDBStore(resolve(config.storage.path));
  await store.initialize();
  try {
    const { computeKpi, formatKpi } = await import("../commands/analyze/kpi.js");
    const kpi = await computeKpi(store, { windowDays: parseInt(opts.windowDays, 10) });
    if (opts.json) {
      console.log(JSON.stringify(kpi, null, 2));
    } else {
      console.log(formatKpi(kpi));
    }
  } finally {
    await store.close();
  }
}

export function registerAnalyzeCommands(program: Command): void {
  const analyze = program
    .command("analyze")
    .description("Read-only inspection of flaker data");

  analyze
    .command("kpi")
    .description("Show KPI dashboard — sampling effectiveness, flaky tracking, data quality")
    .option("--window-days <days>", "Analysis window in days", "30")
    .option("--json", "Output as JSON")
    .action(analyzeKpiAction);

  analyze
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

  analyze
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

  analyze
    .command("insights")
    .description("Compare CI vs local failure patterns to identify environment-specific issues")
    .option("--window-days <days>", "Analysis window in days", "90")
    .option("--top <n>", "Number of tests to show per category", "20")
    .action(async (opts: { windowDays: string; top: string }) => {
      const config = loadConfig(process.cwd());
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();
      try {
        const { runInsights: _runInsights, formatInsights } = await import("../commands/analyze/insights.js");
        const result = await _runInsights({
          store,
          windowDays: parseInt(opts.windowDays, 10),
          top: parseInt(opts.top, 10),
        });
        console.log(formatInsights(result));
      } finally {
        await store.close();
      }
    });

  analyze
    .command("eval")
    .description("Measure whether local sampled runs predict CI")
    .option("--window <days>", "Analysis window in days")
    .option("--json", "Output raw JSON report")
    .option("--markdown", "Output markdown review report")
    .option("--output <file>", "Write eval report to a file")
    .action(async (opts: { window?: string; json?: boolean; markdown?: boolean; output?: string }) => {
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
        const rendered = renderEvalReport(report, {
          json: opts.json,
          markdown: opts.markdown,
          windowDays,
        });
        console.log(rendered);
        if (opts.output) {
          writeEvalReport(resolve(process.cwd(), opts.output), rendered);
        }
      } finally {
        await store.close();
      }
    });

  analyze
    .command("context")
    .description("Show environment data and strategy characteristics for decision-making")
    .option("--json", "Output as JSON for programmatic consumption")
    .action(async (opts) => {
      const config = loadConfig(process.cwd());
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();

      try {
        const hasResolver = !!(config as any).affected;
        const { buildContext, formatContext } = await import("../commands/analyze/context.js");
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

  const queryCmd = analyze
    .command("query <sql>")
    .description("Execute a read-only SQL query against the metrics database");

  queryCmd.addHelpText("after", `
Examples:
  flaker analyze query "SELECT test_name, COUNT(*) AS fails FROM test_results WHERE status='failed' GROUP BY 1 ORDER BY fails DESC LIMIT 10"
  flaker analyze query "SELECT commit_sha, AVG(CASE WHEN status='failed' THEN 1.0 ELSE 0 END) AS fail_rate FROM test_results GROUP BY 1 ORDER BY fail_rate DESC LIMIT 20"
  flaker analyze query "SELECT * FROM test_results ORDER BY created_at DESC LIMIT 20"
`);

  queryCmd.action(async (sql: string) => {
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
}
