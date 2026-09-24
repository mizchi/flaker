import { resolve } from "node:path";
import { loadConfig } from "../config.js";
import { DuckDBStore } from "../storage/duckdb.js";
import { runReason, formatReasoningReport } from "../commands/analyze/reason.js";
import { formatFailureClusters, runFailureClusters } from "../commands/analyze/cluster.js";
import { runQuery, formatQueryResult } from "../commands/analyze/query.js";
import { formatAnalysisBundle, runAnalysisBundle } from "../commands/analyze/bundle.js";
import {
  formatStatusSummary,
  formatStatusMarkdown,
  renderDetail,
  renderListFlaky,
  renderListQuarantined,
  runStatusSummary,
  runStatusListFlaky,
  runStatusListQuarantined,
} from "../commands/status/summary.js";
import { type GateName, VALID_GATE_NAMES } from "../gate.js";
import { parseTagOption, WorkflowFilterError } from "../workflow-filter.js";

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

export async function statusAction(opts: {
  windowDays: string;
  json?: boolean;
  markdown?: boolean;
  list?: string;
  detail?: boolean;
  gate?: string;
}): Promise<void> {
  // Mutual exclusion checks
  if (opts.markdown && opts.json) {
    console.error("Error: --markdown and --json are mutually exclusive");
    process.exit(2);
  }
  if (opts.list && (opts.markdown || opts.detail)) {
    console.error("Error: --list is a standalone mode and cannot be combined with --markdown or --detail");
    process.exit(2);
  }

  const config = loadConfig(process.cwd());
  const store = new DuckDBStore(resolve(config.storage.path));
  await store.initialize();
  try {
    // --list modes: standalone, skip normal summary
    if (opts.list === "flaky") {
      const rows = await runStatusListFlaky({ store, windowDays: parseInt(opts.windowDays, 10) });
      console.log(renderListFlaky(rows));
      return;
    }
    if (opts.list === "quarantined") {
      const rows = await runStatusListQuarantined({ store });
      console.log(renderListQuarantined(rows));
      return;
    }
    if (opts.list) {
      console.error(`Error: unknown --list value '${opts.list}'. Use 'flaky' or 'quarantined'.`);
      process.exit(2);
    }

    if (opts.gate && !(VALID_GATE_NAMES as readonly string[]).includes(opts.gate)) {
      console.error(
        `Error: unknown --gate value '${opts.gate}'. Valid gates: ${VALID_GATE_NAMES.join(" | ")}.`,
      );
      process.exit(2);
    }

    const gate = opts.gate as GateName | undefined;
    const summary = await runStatusSummary({
      store,
      config,
      windowDays: parseInt(opts.windowDays, 10),
      gate,
    });

    let output: string;
    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    } else if (opts.markdown) {
      output = formatStatusMarkdown(summary);
    } else {
      output = formatStatusSummary(summary);
    }

    if (opts.detail) {
      output += "\n\n" + renderDetail(summary.drift, config.promotion);
    }

    console.log(output);
  } finally {
    await store.close();
  }
}

export async function analyzeBundleAction(opts: { windowDays: string; output?: string }): Promise<void> {
  const { writeFileSync } = await import("node:fs");
  const config = loadConfig(process.cwd());
  const store = new DuckDBStore(resolve(config.storage.path));
  await store.initialize();
  try {
    const bundle = await runAnalysisBundle({
      store,
      storagePath: config.storage.path,
      resolverConfigured: !!(config as any).affected,
      windowDays: parseInt(opts.windowDays, 10),
    });
    const rendered = formatAnalysisBundle(bundle);
    console.log(rendered);
    if (opts.output) {
      writeFileSync(resolve(process.cwd(), opts.output), rendered, "utf8");
    }
  } finally {
    await store.close();
  }
}

export async function analyzeClusterAction(opts: {
  windowDays: string;
  minCoFailures: string;
  minCoRate: string;
  top: string;
  json?: boolean;
  workflow?: string;
  lane?: string;
  tag?: string[];
}): Promise<void> {
  const workflowFilter = parseWorkflowFilterOptions({
    workflow: opts.workflow,
    lane: opts.lane,
    tag: opts.tag,
  });
  const config = loadConfig(process.cwd());
  const store = new DuckDBStore(resolve(config.storage.path));
  await store.initialize();
  try {
    const clusters = await runFailureClusters({
      store,
      windowDays: parseInt(opts.windowDays, 10),
      minCoFailures: parseInt(opts.minCoFailures, 10),
      minCoRate: Number(opts.minCoRate),
      top: parseInt(opts.top, 10),
      ...(workflowFilter ? { workflow: workflowFilter } : {}),
    });
    if (opts.json) {
      console.log(JSON.stringify(clusters, null, 2));
    } else {
      console.log(formatFailureClusters(clusters));
    }
  } finally {
    await store.close();
  }
}

function parseWorkflowFilterOptions(opts: {
  workflow?: string;
  lane?: string;
  tag?: string[];
}): { name?: string; lane?: string; tags?: Record<string, string> } | undefined {
  let tags: Record<string, string> | undefined;
  try {
    tags = parseTagOption(opts.tag);
  } catch (err) {
    if (err instanceof WorkflowFilterError) {
      console.error(`Error: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }
  const hasAny = opts.workflow != null || opts.lane != null || (tags && Object.keys(tags).length > 0);
  if (!hasAny) return undefined;
  return {
    ...(opts.workflow ? { name: opts.workflow } : {}),
    ...(opts.lane ? { lane: opts.lane } : {}),
    ...(tags ? { tags } : {}),
  };
}

export async function analyzeReasonAction(opts: { window: string; json?: boolean }): Promise<void> {
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
}

export async function analyzeInsightsAction(opts: { windowDays: string; top: string }): Promise<void> {
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
}

export async function analyzeContextAction(opts: { json?: boolean }): Promise<void> {
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
}

export async function analyzeQueryAction(sql: string): Promise<void> {
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
}
