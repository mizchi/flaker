import type { MetricStore } from "../storage/types.js";

export interface EvalReport {
  dataSufficiency: {
    totalRuns: number;
    totalResults: number;
    uniqueTests: number;
    firstDate: string | null;
    lastDate: string | null;
    avgRunsPerTest: number;
  };
  detection: {
    flakyTests: number;
    trueFlakyTests: number;
    quarantinedTests: number;
    distribution: { range: string; count: number }[];
  };
  resolution: {
    resolvedFlaky: number;
    newFlaky: number;
    mttdDays: number | null;
    mttrDays: number | null;
  };
  healthScore: number;
}

export async function runEval(opts: { store: MetricStore; windowDays?: number }): Promise<EvalReport> {
  const { store } = opts;
  const windowDays = opts.windowDays ?? 30;

  // 1. Data Sufficiency
  const [statsRow] = await store.raw<{
    total_runs: number;
    total_results: number;
    unique_tests: number;
    first_date: string | null;
    last_date: string | null;
    avg_runs: number;
  }>(`
    SELECT
      (SELECT COUNT(*)::INTEGER FROM workflow_runs) AS total_runs,
      (SELECT COUNT(*)::INTEGER FROM test_results) AS total_results,
      (SELECT COUNT(DISTINCT suite || '::' || test_name)::INTEGER FROM test_results) AS unique_tests,
      (SELECT MIN(created_at)::VARCHAR FROM test_results) AS first_date,
      (SELECT MAX(created_at)::VARCHAR FROM test_results) AS last_date,
      COALESCE((SELECT ROUND(COUNT(*) * 1.0 / NULLIF(COUNT(DISTINCT suite || '::' || test_name), 0), 1)::DOUBLE FROM test_results), 0) AS avg_runs
  `);

  // 2. Detection
  const flakyTests = await store.queryFlakyTests({ windowDays });
  const trueFlakyTests = await store.queryTrueFlakyTests();
  const quarantined = await store.queryQuarantined();

  // Distribution
  const distribution = [
    { range: "0-10%", count: 0 },
    { range: "10-30%", count: 0 },
    { range: "30-50%", count: 0 },
    { range: "50-100%", count: 0 },
  ];
  for (const f of flakyTests) {
    if (f.flakyRate <= 10) distribution[0].count++;
    else if (f.flakyRate <= 30) distribution[1].count++;
    else if (f.flakyRate <= 50) distribution[2].count++;
    else distribution[3].count++;
  }

  // 3. Resolution tracking
  const [resolutionRow] = await store.raw<{
    resolved_flaky: number;
    new_flaky: number;
  }>(`
    WITH
    older_flaky AS (
      SELECT DISTINCT suite, test_name FROM test_results
      WHERE status IN ('failed', 'flaky')
        AND created_at < CURRENT_TIMESTAMP - INTERVAL '7 days'
    ),
    recent_flaky AS (
      SELECT DISTINCT suite, test_name FROM test_results
      WHERE status IN ('failed', 'flaky')
        AND created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
    ),
    recent_any AS (
      SELECT DISTINCT suite, test_name FROM test_results
      WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
    )
    SELECT
      (SELECT COUNT(*)::INTEGER FROM older_flaky o
       WHERE NOT EXISTS (SELECT 1 FROM recent_flaky r WHERE r.suite = o.suite AND r.test_name = o.test_name)
         AND EXISTS (SELECT 1 FROM recent_any a WHERE a.suite = o.suite AND a.test_name = o.test_name)
      ) AS resolved_flaky,
      (SELECT COUNT(*)::INTEGER FROM recent_flaky r
       WHERE NOT EXISTS (SELECT 1 FROM older_flaky o WHERE o.suite = r.suite AND o.test_name = r.test_name)
      ) AS new_flaky
  `);

  // MTTD/MTTR (averages across all flaky tests)
  const [timingRow] = await store.raw<{
    avg_mttd_days: number | null;
    avg_mttr_days: number | null;
  }>(`
    WITH flaky_lifecycle AS (
      SELECT
        suite, test_name,
        MIN(created_at) FILTER (WHERE status IN ('failed', 'flaky')) AS first_failure,
        MAX(created_at) FILTER (WHERE status IN ('failed', 'flaky')) AS last_failure,
        MIN(created_at) AS first_seen
      FROM test_results
      GROUP BY suite, test_name
      HAVING COUNT(*) FILTER (WHERE status IN ('failed', 'flaky')) > 0
    )
    SELECT
      ROUND(AVG(EXTRACT(EPOCH FROM (first_failure - first_seen)) / 86400), 1)::DOUBLE AS avg_mttd_days,
      ROUND(AVG(EXTRACT(EPOCH FROM (last_failure - first_failure)) / 86400), 1)::DOUBLE AS avg_mttr_days
    FROM flaky_lifecycle
    WHERE first_failure IS NOT NULL
  `);

  // 4. Health Score
  const uniqueTests = statsRow?.unique_tests ?? 0;
  const stability = uniqueTests > 0
    ? ((uniqueTests - flakyTests.length) / uniqueTests) * 100
    : 100;
  const coverage = Math.min((statsRow?.avg_runs ?? 0) / 10, 1.0) * 100;
  const resolution = flakyTests.length > 0
    ? ((resolutionRow?.resolved_flaky ?? 0) / flakyTests.length) * 100
    : 100;
  const healthScore = Math.round(stability * 0.5 + coverage * 0.3 + resolution * 0.2);

  return {
    dataSufficiency: {
      totalRuns: statsRow?.total_runs ?? 0,
      totalResults: statsRow?.total_results ?? 0,
      uniqueTests,
      firstDate: statsRow?.first_date ?? null,
      lastDate: statsRow?.last_date ?? null,
      avgRunsPerTest: statsRow?.avg_runs ?? 0,
    },
    detection: {
      flakyTests: flakyTests.length,
      trueFlakyTests: trueFlakyTests.length,
      quarantinedTests: quarantined.length,
      distribution,
    },
    resolution: {
      resolvedFlaky: resolutionRow?.resolved_flaky ?? 0,
      newFlaky: resolutionRow?.new_flaky ?? 0,
      mttdDays: timingRow?.avg_mttd_days ?? null,
      mttrDays: timingRow?.avg_mttr_days ?? null,
    },
    healthScore,
  };
}

export function formatEvalReport(report: EvalReport): string {
  const lines: string[] = [];

  lines.push("# flaker Evaluation Report");
  lines.push("");

  // Health Score
  const label = report.healthScore >= 80 ? "GOOD" : report.healthScore >= 50 ? "FAIR" : "POOR";
  lines.push(`## Health Score: ${report.healthScore}/100 (${label})`);
  lines.push("");

  // Data Sufficiency
  lines.push("## Data Sufficiency");
  const d = report.dataSufficiency;
  lines.push(`  Workflow runs:    ${d.totalRuns}`);
  lines.push(`  Test results:     ${d.totalResults}`);
  lines.push(`  Unique tests:     ${d.uniqueTests}`);
  lines.push(`  Avg runs/test:    ${d.avgRunsPerTest}`);
  lines.push(`  Date range:       ${d.firstDate ?? "N/A"} -> ${d.lastDate ?? "N/A"}`);
  if (d.avgRunsPerTest < 5) {
    lines.push(`  WARNING: Need more data (avg ${d.avgRunsPerTest} runs/test, recommend >= 10)`);
  }
  lines.push("");

  // Detection
  lines.push("## Detection");
  const det = report.detection;
  lines.push(`  Flaky tests:      ${det.flakyTests}`);
  lines.push(`  True flaky:       ${det.trueFlakyTests}`);
  lines.push(`  Quarantined:      ${det.quarantinedTests}`);
  lines.push(`  Distribution:`);
  for (const b of det.distribution) {
    const bar = "#".repeat(b.count);
    lines.push(`    ${b.range.padEnd(8)} ${bar} ${b.count}`);
  }
  lines.push("");

  // Resolution
  lines.push("## Resolution");
  const res = report.resolution;
  lines.push(`  Resolved flaky:   ${res.resolvedFlaky}`);
  lines.push(`  New flaky:        ${res.newFlaky}`);
  lines.push(`  Avg MTTD:         ${res.mttdDays != null ? res.mttdDays + " days" : "N/A"}`);
  lines.push(`  Avg MTTR:         ${res.mttrDays != null ? res.mttrDays + " days" : "N/A"}`);
  lines.push("");

  // Recommendations
  lines.push("## Recommendations");
  if (d.avgRunsPerTest < 5) {
    lines.push("  - Collect more data: run `flaker collect` regularly to build history");
  }
  if (det.flakyTests > 0 && det.quarantinedTests === 0) {
    lines.push("  - Quarantine flaky tests: run `flaker quarantine --auto`");
  }
  if (res.newFlaky > 0) {
    lines.push(`  - Investigate ${res.newFlaky} newly flaky test(s): run \`flaker flaky\``);
  }
  if (det.flakyTests === 0 && d.totalResults > 0) {
    lines.push("  - No flaky tests detected. Suite is healthy!");
  }
  if (d.totalResults === 0) {
    lines.push("  - No data yet. Run `flaker collect` or `flaker import` to get started");
  }

  return lines.join("\n");
}
