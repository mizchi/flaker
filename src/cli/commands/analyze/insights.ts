import type { MetricStore } from "../../storage/types.js";
import { workflowRunSourceSql } from "../../run-source.js";

export interface InsightsOpts {
  store: MetricStore;
  windowDays?: number;
  top?: number;
}

interface TestSourceStats {
  suite: string;
  testName: string;
  ciRuns: number;
  ciFails: number;
  localRuns: number;
  localFails: number;
  ciFlakyRate: number;
  localFlakyRate: number;
}

export interface InsightsResult {
  /** Tests that fail locally but pass in CI — likely WIP or environment issues */
  localOnly: TestSourceStats[];
  /** Tests that fail in CI but pass locally — CI-specific issues (network, services, timing) */
  ciOnly: TestSourceStats[];
  /** Tests that fail in both — real flaky tests */
  both: TestSourceStats[];
  /** Summary counts */
  summary: {
    totalTests: number;
    ciOnlyCount: number;
    localOnlyCount: number;
    bothCount: number;
    stableCount: number;
  };
}

export async function runInsights(opts: InsightsOpts): Promise<InsightsResult> {
  const window = opts.windowDays ?? 90;
  const top = opts.top ?? 20;
  const workflowSourceExpr = workflowRunSourceSql("wr");

  const rows = await opts.store.raw<{
    suite: string;
    test_name: string;
    ci_runs: number;
    ci_fails: number;
    local_runs: number;
    local_fails: number;
  }>(`
    SELECT
      tr.suite,
      tr.test_name,
      COUNT(*) FILTER (WHERE ${workflowSourceExpr} = 'ci')::INTEGER AS ci_runs,
      COUNT(*) FILTER (WHERE ${workflowSourceExpr} = 'ci'
        AND tr.status IN ('failed', 'flaky'))::INTEGER AS ci_fails,
      COUNT(*) FILTER (WHERE ${workflowSourceExpr} = 'local')::INTEGER AS local_runs,
      COUNT(*) FILTER (WHERE ${workflowSourceExpr} = 'local'
        AND tr.status IN ('failed', 'flaky'))::INTEGER AS local_fails
    FROM test_results tr
    LEFT JOIN workflow_runs wr ON tr.workflow_run_id = wr.id
    WHERE tr.created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
    GROUP BY tr.suite, tr.test_name
    HAVING ci_runs + local_runs >= 2
  `);

  const stats: TestSourceStats[] = rows.map((r) => ({
    suite: r.suite,
    testName: r.test_name,
    ciRuns: r.ci_runs,
    ciFails: r.ci_fails,
    localRuns: r.local_runs,
    localFails: r.local_fails,
    ciFlakyRate: r.ci_runs > 0 ? Math.round((r.ci_fails / r.ci_runs) * 1000) / 10 : 0,
    localFlakyRate: r.local_runs > 0 ? Math.round((r.local_fails / r.local_runs) * 1000) / 10 : 0,
  }));

  // Single-pass classification
  const localOnlyAll: TestSourceStats[] = [];
  const ciOnlyAll: TestSourceStats[] = [];
  const bothAll: TestSourceStats[] = [];
  let stableCount = 0;
  for (const s of stats) {
    if (s.ciFails > 0 && s.localFails > 0) bothAll.push(s);
    else if (s.ciFails > 0) ciOnlyAll.push(s);
    else if (s.localFails > 0) localOnlyAll.push(s);
    else stableCount++;
  }

  localOnlyAll.sort((a, b) => b.localFlakyRate - a.localFlakyRate);
  ciOnlyAll.sort((a, b) => b.ciFlakyRate - a.ciFlakyRate);
  bothAll.sort((a, b) => (b.ciFlakyRate + b.localFlakyRate) - (a.ciFlakyRate + a.localFlakyRate));

  return {
    localOnly: localOnlyAll.slice(0, top),
    ciOnly: ciOnlyAll.slice(0, top),
    both: bothAll.slice(0, top),
    summary: {
      totalTests: stats.length,
      ciOnlyCount: ciOnlyAll.length,
      localOnlyCount: localOnlyAll.length,
      bothCount: bothAll.length,
      stableCount,
    },
  };
}

function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

function pad(s: string, w: number): string {
  return s.length > w ? s.slice(0, w - 1) + "…" : s.padEnd(w);
}

function formatSection(title: string, explanation: string, tests: TestSourceStats[], showLocal: boolean, showCi: boolean): string {
  if (tests.length === 0) return "";
  const lines = [`## ${title}`, explanation, ""];

  const headers = [pad("Suite", 40), pad("Test", 30)];
  const dashes = ["-".repeat(40), "-".repeat(30)];
  if (showCi) {
    headers.push(pad("CI", 12));
    dashes.push("-".repeat(12));
  }
  if (showLocal) {
    headers.push(pad("Local", 12));
    dashes.push("-".repeat(12));
  }
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`|${dashes.map((d) => `-${d}-`).join("|")}|`);

  for (const t of tests) {
    const cols = [pad(t.suite, 40), pad(t.testName, 30)];
    if (showCi) cols.push(pad(`${pct(t.ciFlakyRate)} (${t.ciFails}/${t.ciRuns})`, 12));
    if (showLocal) cols.push(pad(`${pct(t.localFlakyRate)} (${t.localFails}/${t.localRuns})`, 12));
    lines.push(`| ${cols.join(" | ")} |`);
  }
  lines.push("");
  return lines.join("\n");
}

export function formatInsights(result: InsightsResult): string {
  const { summary: s } = result;
  const lines = [
    "# CI vs Local Failure Insights",
    "",
    `Tests analyzed: ${s.totalTests}  |  Stable: ${s.stableCount}  |  CI-only failures: ${s.ciOnlyCount}  |  Local-only: ${s.localOnlyCount}  |  Both: ${s.bothCount}`,
    "",
  ];

  lines.push(formatSection(
    "Local-only failures",
    "Fail locally but pass in CI. Likely causes: uncommitted changes, environment differences, WIP code.",
    result.localOnly, true, false,
  ));

  lines.push(formatSection(
    "CI-only failures",
    "Fail in CI but pass locally. Likely causes: network dependencies, service availability, timing sensitivity.",
    result.ciOnly, false, true,
  ));

  lines.push(formatSection(
    "Failures in both CI and Local",
    "Genuine flaky tests. These are the highest-priority targets for stabilization.",
    result.both, true, true,
  ));

  if (result.localOnly.length === 0 && result.ciOnly.length === 0 && result.both.length === 0) {
    lines.push("No failure divergence detected between CI and local runs.");
    lines.push("Run more tests locally with `flaker run` to build comparison data.");
  }

  return lines.join("\n");
}
