import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { MetricStore } from "../../storage/types.js";
import { MOONBIT_JS_BRIDGE_URL } from "../../core/build-artifact.js";

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
    flakyTestDetails?: { flakyRate: number; totalRuns: number }[];
  };
  resolution: {
    resolvedFlaky: number;
    newFlaky: number;
    mttdDays: number | null;
    mttrDays: number | null;
  };
  samplingKpi: SamplingKpiReport;
  healthScore: number;
}

type EvalReportFormat = "text" | "markdown";

interface EvalFormatOpts {
  windowDays?: number;
}

export interface EvalRenderOpts extends EvalFormatOpts {
  json?: boolean;
  markdown?: boolean;
}

interface PredictiveSignalSummary {
  localPassCommits?: number;
  ciPassWhenLocalPass?: number;
  localFailCommits?: number;
  ciFailWhenLocalFail?: number;
  rate: number | null;
}

interface SamplingKpiReport {
  matchedCommits: number;
  localOnlyCommits: number;
  ciOnlyCommits: number;
  avgLocalSampleSize: number | null;
  medianLocalSampleSize: number | null;
  p95LocalSampleSize: number | null;
  avgCiTestCount: number | null;
  avgSampleRatio: number | null;
  avgSavedMinutes: number | null;
  fallbackRuns: number;
  fallbackRate: number | null;
  passSignal: {
    localPassCommits: number;
    ciPassWhenLocalPass: number;
    rate: number | null;
  };
  failSignal: {
    localFailCommits: number;
    ciFailWhenLocalFail: number;
    rate: number | null;
  };
  misses: {
    localPassButCiFail: number;
    localFailButCiPass: number;
    falseNegativeRate: number | null;
    falsePositiveRate: number | null;
  };
  confusionMatrix: {
    truePositive: number;
    falsePositive: number;
    falseNegative: number;
    trueNegative: number;
  };
}

interface CommitSignalRow {
  commit_sha: string;
  run_kind: "local" | "ci";
  run_count: number;
  distinct_tests: number;
  failure_signals: number;
  duration_ms: number | null;
  fallback_used: boolean;
}

interface CommitSignal {
  commitSha: string;
  runKind: "local" | "ci";
  runCount: number;
  distinctTests: number;
  failureSignals: number;
  durationMs: number | null;
  fallbackUsed: boolean;
}

interface EvalCommitSignalInput {
  commit_sha: string;
  run_kind: "local" | "ci";
  run_count: number;
  distinct_tests: number;
  failure_signals: number;
  duration_ms: number | null;
  fallback_used: boolean;
}

interface SamplingKpiSignalOutput {
  local_commits: number;
  ci_when_local: number;
  rate: number | null;
}

interface SamplingKpiMissesOutput {
  local_pass_but_ci_fail: number;
  local_fail_but_ci_pass: number;
  false_negative_rate: number | null;
  false_positive_rate: number | null;
}

interface SamplingKpiConfusionMatrixOutput {
  true_positive: number;
  false_positive: number;
  false_negative: number;
  true_negative: number;
}

interface SamplingKpiOutput {
  matched_commits: number;
  local_only_commits: number;
  ci_only_commits: number;
  avg_local_sample_size: number | null;
  median_local_sample_size: number | null;
  p95_local_sample_size: number | null;
  avg_ci_test_count: number | null;
  avg_sample_ratio: number | null;
  avg_saved_minutes: number | null;
  fallback_runs: number;
  fallback_rate: number | null;
  pass_signal: SamplingKpiSignalOutput;
  fail_signal: SamplingKpiSignalOutput;
  misses: SamplingKpiMissesOutput;
  confusion_matrix: SamplingKpiConfusionMatrixOutput;
}

interface EvalCoreExports {
  build_sampling_kpi_json?: (rowsJson: string) => string;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(1));
}

function percentileNearestRank(values: number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(percentile * sorted.length));
  return sorted[rank - 1] ?? null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function toRate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return roundMetric((numerator * 100) / denominator);
}

function buildPredictiveSignalSummary(
  localCommits: number,
  ciCommits: number,
): PredictiveSignalSummary {
  return {
    rate: toRate(ciCommits, localCommits),
  };
}

function healthScoreLabel(score: number): string {
  return score >= 80 ? "GOOD" : score >= 50 ? "FAIR" : "POOR";
}

function formatRateValue(rate: number | null, detail?: string): string {
  if (rate == null) return "N/A";
  return detail ? `${rate}% (${detail})` : `${rate}%`;
}

function buildEvalRecommendations(report: EvalReport): string[] {
  const recommendations: string[] = [];
  const d = report.dataSufficiency;
  const det = report.detection;
  const res = report.resolution;
  const kpi = report.samplingKpi;

  if (d.avgRunsPerTest < 5) {
    recommendations.push("Collect more data: run `flaker collect` regularly to build history");
  }
  const brokenInEval = det.flakyTestDetails?.filter(
    (t) => t.flakyRate >= 100 && t.totalRuns >= 5,
  ).length ?? 0;
  if (brokenInEval > 0) {
    recommendations.push(`Fix or quarantine ${brokenInEval} broken test(s) (100% fail rate): run \`flaker flaky\``);
  }
  const intermittentInEval = det.flakyTests - brokenInEval;
  if (intermittentInEval > 0 && det.quarantinedTests === 0) {
    recommendations.push(`Quarantine ${intermittentInEval} flaky test(s): run \`flaker quarantine --auto\``);
  }
  if (res.newFlaky > 0) {
    recommendations.push(`Investigate ${res.newFlaky} newly flaky test(s): run \`flaker flaky\``);
  }
  if (det.flakyTests === 0 && d.totalResults > 0) {
    recommendations.push("No flaky tests detected. Suite is healthy!");
  }
  if (d.totalResults === 0) {
    recommendations.push("No data yet. Run `flaker collect` or `flaker import` to get started");
  }
  if (kpi.matchedCommits === 0 && d.totalResults > 0) {
    recommendations.push("No matched local/CI commit history yet. Import local runs with the same commit SHA to measure sampling quality");
  }
  if (kpi.passSignal.rate != null && kpi.passSignal.rate < 95) {
    recommendations.push("Local pass is not yet a strong CI predictor. Increase sample size or improve affected mapping");
  }
  if (kpi.failSignal.rate != null && kpi.failSignal.rate < 50) {
    recommendations.push("Local failures are weak CI signals. Check for noisy tests or mismatched local/CI environments");
  }
  if (kpi.avgSampleRatio != null && kpi.avgSampleRatio > 50) {
    recommendations.push("Local sample size is large relative to CI. Tighten affected rules or reduce default N");
  }

  return recommendations;
}

function averageDurationDeltaMinutes(rows: Array<{ localDurationMs: number; ciDurationMs: number }>): number | null {
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, row) => sum + ((row.ciDurationMs - row.localDurationMs) / 60_000), 0);
  return roundMetric(total / rows.length);
}

function buildSamplingKpiFallback(rows: CommitSignal[]): SamplingKpiReport {
  const localByCommit = new Map<string, CommitSignal>();
  const ciByCommit = new Map<string, CommitSignal>();

  for (const row of rows) {
    if (row.runKind === "local") {
      localByCommit.set(row.commitSha, row);
    } else {
      ciByCommit.set(row.commitSha, row);
    }
  }

  const localOnlyCommits = [...localByCommit.keys()].filter((commitSha) => !ciByCommit.has(commitSha)).length;
  const ciOnlyCommits = [...ciByCommit.keys()].filter((commitSha) => !localByCommit.has(commitSha)).length;

  const sampleSizes: number[] = [];
  const ciTestCounts: number[] = [];
  const sampleRatios: number[] = [];
  const savedMinutesRows: Array<{ localDurationMs: number; ciDurationMs: number }> = [];
  const fallbackRuns = rows.filter((row) => row.runKind === "local" && row.fallbackUsed).length;

  let localPassCommits = 0;
  let ciPassWhenLocalPass = 0;
  let localFailCommits = 0;
  let ciFailWhenLocalFail = 0;
  let localPassButCiFail = 0;
  let localFailButCiPass = 0;
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;

  const matchedCommitShas = [...localByCommit.keys()].filter((commitSha) => ciByCommit.has(commitSha));
  for (const commitSha of matchedCommitShas) {
    const local = localByCommit.get(commitSha)!;
    const ci = ciByCommit.get(commitSha)!;
    const localFailed = local.failureSignals > 0;
    const ciFailed = ci.failureSignals > 0;

    sampleSizes.push(local.distinctTests);
    ciTestCounts.push(ci.distinctTests);
    if (ci.distinctTests > 0) {
      sampleRatios.push((local.distinctTests / ci.distinctTests) * 100);
    }
    if (local.durationMs != null && ci.durationMs != null) {
      savedMinutesRows.push({
        localDurationMs: local.durationMs,
        ciDurationMs: ci.durationMs,
      });
    }

    if (localFailed) {
      localFailCommits++;
      if (ciFailed) {
        ciFailWhenLocalFail++;
        truePositive++;
      } else {
        localFailButCiPass++;
        falsePositive++;
      }
      continue;
    }

    localPassCommits++;
    if (ciFailed) {
      localPassButCiFail++;
      falseNegative++;
    } else {
      ciPassWhenLocalPass++;
      trueNegative++;
    }
  }

  const passSignal = buildPredictiveSignalSummary(localPassCommits, ciPassWhenLocalPass);
  const failSignal = buildPredictiveSignalSummary(localFailCommits, ciFailWhenLocalFail);

  return {
    matchedCommits: matchedCommitShas.length,
    localOnlyCommits,
    ciOnlyCommits,
    avgLocalSampleSize: sampleSizes.length > 0
      ? roundMetric(sampleSizes.reduce((sum, value) => sum + value, 0) / sampleSizes.length)
      : null,
    medianLocalSampleSize: sampleSizes.length > 0
      ? roundMetric(median(sampleSizes) ?? 0)
      : null,
    p95LocalSampleSize: sampleSizes.length > 0
      ? roundMetric(percentileNearestRank(sampleSizes, 0.95) ?? 0)
      : null,
    avgCiTestCount: ciTestCounts.length > 0
      ? roundMetric(ciTestCounts.reduce((sum, value) => sum + value, 0) / ciTestCounts.length)
      : null,
    avgSampleRatio: sampleRatios.length > 0
      ? roundMetric(sampleRatios.reduce((sum, value) => sum + value, 0) / sampleRatios.length)
      : null,
    avgSavedMinutes: averageDurationDeltaMinutes(savedMinutesRows),
    fallbackRuns,
    fallbackRate: toRate(fallbackRuns, localByCommit.size),
    passSignal: {
      localPassCommits,
      ciPassWhenLocalPass,
      rate: passSignal.rate,
    },
    failSignal: {
      localFailCommits,
      ciFailWhenLocalFail,
      rate: failSignal.rate,
    },
    misses: {
      localPassButCiFail,
      localFailButCiPass,
      falseNegativeRate: toRate(localPassButCiFail, localPassCommits),
      falsePositiveRate: toRate(localFailButCiPass, localFailCommits),
    },
    confusionMatrix: {
      truePositive,
      falsePositive,
      falseNegative,
      trueNegative,
    },
  };
}

function toCoreCommitSignal(row: CommitSignal): EvalCommitSignalInput {
  return {
    commit_sha: row.commitSha,
    run_kind: row.runKind,
    run_count: row.runCount,
    distinct_tests: row.distinctTests,
    failure_signals: row.failureSignals,
    duration_ms: row.durationMs,
    fallback_used: row.fallbackUsed,
  };
}

function fromCoreSamplingKpi(output: SamplingKpiOutput): SamplingKpiReport {
  return {
    matchedCommits: output.matched_commits,
    localOnlyCommits: output.local_only_commits,
    ciOnlyCommits: output.ci_only_commits,
    avgLocalSampleSize: output.avg_local_sample_size,
    medianLocalSampleSize: output.median_local_sample_size,
    p95LocalSampleSize: output.p95_local_sample_size,
    avgCiTestCount: output.avg_ci_test_count,
    avgSampleRatio: output.avg_sample_ratio,
    avgSavedMinutes: output.avg_saved_minutes,
    fallbackRuns: output.fallback_runs,
    fallbackRate: output.fallback_rate,
    passSignal: {
      localPassCommits: output.pass_signal.local_commits,
      ciPassWhenLocalPass: output.pass_signal.ci_when_local,
      rate: output.pass_signal.rate,
    },
    failSignal: {
      localFailCommits: output.fail_signal.local_commits,
      ciFailWhenLocalFail: output.fail_signal.ci_when_local,
      rate: output.fail_signal.rate,
    },
    misses: {
      localPassButCiFail: output.misses.local_pass_but_ci_fail,
      localFailButCiPass: output.misses.local_fail_but_ci_pass,
      falseNegativeRate: output.misses.false_negative_rate,
      falsePositiveRate: output.misses.false_positive_rate,
    },
    confusionMatrix: {
      truePositive: output.confusion_matrix.true_positive,
      falsePositive: output.confusion_matrix.false_positive,
      falseNegative: output.confusion_matrix.false_negative,
      trueNegative: output.confusion_matrix.true_negative,
    },
  };
}

function isExtendedSamplingKpiOutput(value: unknown): value is SamplingKpiOutput {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.matched_commits === "number" &&
    "avg_saved_minutes" in candidate &&
    "fallback_runs" in candidate &&
    "fallback_rate" in candidate
  );
}

async function loadSamplingKpiBuilder(): Promise<
  (rows: CommitSignal[]) => SamplingKpiReport
> {
  try {
    const mod = (await import(MOONBIT_JS_BRIDGE_URL.href)) as EvalCoreExports;
    if (typeof mod.build_sampling_kpi_json === "function") {
      return (rows) => {
        try {
          const parsed = JSON.parse(
            mod.build_sampling_kpi_json!(JSON.stringify(rows.map(toCoreCommitSignal))),
          ) as unknown;
          if (isExtendedSamplingKpiOutput(parsed)) {
            return fromCoreSamplingKpi(parsed);
          }
        } catch {
          // MoonBit bridge panic — fall through to TS fallback
        }
        return buildSamplingKpiFallback(rows);
      };
    }
  } catch {
    // Fall back to the TypeScript reducer when the MoonBit build is unavailable.
  }

  return buildSamplingKpiFallback;
}

const buildSamplingKpi = await loadSamplingKpiBuilder();

export async function runSamplingKpi(
  opts: { store: MetricStore; windowDays?: number },
): Promise<SamplingKpiReport> {
  const { store } = opts;
  const windowDays = opts.windowDays ?? 30;
  const commitSignalRows = await store.raw<CommitSignalRow>(`
    WITH recent_results AS (
      SELECT
        wr.commit_sha,
        wr.event,
        wr.id AS workflow_run_id,
        wr.duration_ms AS workflow_duration_ms,
        tr.test_id,
        tr.suite,
        tr.test_name,
        tr.status,
        tr.retry_count
      FROM workflow_runs wr
      INNER JOIN test_results tr ON tr.workflow_run_id = wr.id
      WHERE tr.created_at > CURRENT_TIMESTAMP - INTERVAL (? || ' days')
    ),
    aggregated_results AS (
      SELECT
        commit_sha,
        CASE
          WHEN event IN ('local-import', 'actrun-local', 'flaker-local-run') THEN 'local'
          ELSE 'ci'
        END AS run_kind,
        COUNT(DISTINCT workflow_run_id)::INTEGER AS run_count,
        COUNT(DISTINCT COALESCE(NULLIF(test_id, ''), suite || '::' || test_name))::INTEGER AS distinct_tests,
        COUNT(*) FILTER (
          WHERE status IN ('failed', 'flaky')
            OR (retry_count > 0 AND status = 'passed')
        )::INTEGER AS failure_signals,
        MAX(workflow_duration_ms)::INTEGER AS duration_ms
      FROM recent_results
      GROUP BY commit_sha, run_kind
    ),
    recent_sampling_runs AS (
      SELECT
        id,
        commit_sha,
        selected_count,
        duration_ms,
        fallback_reason,
        ROW_NUMBER() OVER (PARTITION BY commit_sha ORDER BY created_at DESC, id DESC) AS row_num
      FROM sampling_runs
      WHERE command_kind = 'run'
        AND created_at > CURRENT_TIMESTAMP - INTERVAL (? || ' days')
    )
    SELECT
      ar.commit_sha,
      ar.run_kind,
      ar.run_count,
      CASE
        WHEN ar.run_kind = 'local' AND rs.selected_count IS NOT NULL THEN rs.selected_count
        ELSE ar.distinct_tests
      END::INTEGER AS distinct_tests,
      ar.failure_signals,
      CASE
        WHEN ar.run_kind = 'local' AND rs.duration_ms IS NOT NULL THEN rs.duration_ms
        ELSE ar.duration_ms
      END::INTEGER AS duration_ms,
      CASE
        WHEN ar.run_kind = 'local' THEN COALESCE(rs.fallback_reason IS NOT NULL, FALSE)
        ELSE FALSE
      END AS fallback_used
    FROM aggregated_results ar
    LEFT JOIN recent_sampling_runs rs
      ON ar.run_kind = 'local'
     AND rs.commit_sha = ar.commit_sha
     AND rs.row_num = 1
  `, [windowDays.toString(), windowDays.toString()]);
  return buildSamplingKpi(
    commitSignalRows.map((row) => ({
      commitSha: row.commit_sha,
      runKind: row.run_kind,
      runCount: row.run_count,
      distinctTests: row.distinct_tests,
      failureSignals: row.failure_signals,
      durationMs: row.duration_ms,
      fallbackUsed: row.fallback_used,
    })),
  );
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

  // 2. Detection (filter to >= 5 runs, consistent with kpi/calibrate)
  const allFlakyTests = await store.queryFlakyTests({ windowDays });
  const flakyTests = allFlakyTests.filter((t) => t.totalRuns >= 5);
  const trueFlakyTests = await store.queryTrueFlakyTests();
  const quarantined = await store.queryQuarantined();

  // Distribution (only tests with >= 5 runs)
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

  const samplingKpi = await runSamplingKpi({ store, windowDays });

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
      flakyTestDetails: flakyTests.map((t) => ({
        flakyRate: t.flakyRate,
        totalRuns: t.totalRuns,
      })),
    },
    resolution: {
      resolvedFlaky: resolutionRow?.resolved_flaky ?? 0,
      newFlaky: resolutionRow?.new_flaky ?? 0,
      mttdDays: timingRow?.avg_mttd_days ?? null,
      mttrDays: timingRow?.avg_mttr_days ?? null,
    },
    samplingKpi,
    healthScore,
  };
}

function formatEvalTextReport(report: EvalReport): string {
  const lines: string[] = [];

  lines.push("# flaker Evaluation Report");
  lines.push("");

  // Health Score
  const label = healthScoreLabel(report.healthScore);
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

  // Detection — distinguish broken (100% fail) from intermittent flaky
  lines.push("## Detection");
  const det = report.detection;
  const brokenCount = det.flakyTestDetails?.filter(
    (t: { flakyRate: number; totalRuns: number }) => t.flakyRate >= 100 && t.totalRuns >= 5,
  ).length ?? 0;
  const intermittentCount = det.flakyTests - brokenCount;
  if (brokenCount > 0) {
    lines.push(`  Broken tests:     ${brokenCount} (100% fail — fix or quarantine)`);
  }
  lines.push(`  Flaky tests:      ${intermittentCount} (intermittent, >= 5 runs)`);
  lines.push(`  Retry flaky:      ${det.trueFlakyTests} (pass+fail within same commit)`);
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

  // Sampling KPI
  lines.push("## Sampling KPI");
  const kpi = report.samplingKpi;
  lines.push(`  Matched commits:          ${kpi.matchedCommits}`);
  lines.push(`  Local-only commits:       ${kpi.localOnlyCommits}`);
  lines.push(`  CI-only commits:          ${kpi.ciOnlyCommits}`);
  lines.push(`  Avg local sample size N:  ${kpi.avgLocalSampleSize ?? "N/A"}`);
  lines.push(`  Median local sample N:    ${kpi.medianLocalSampleSize ?? "N/A"}`);
  lines.push(`  P95 local sample N:       ${kpi.p95LocalSampleSize ?? "N/A"}`);
  lines.push(`  Avg CI test count:        ${kpi.avgCiTestCount ?? "N/A"}`);
  lines.push(`  Avg sample ratio:         ${kpi.avgSampleRatio != null ? `${kpi.avgSampleRatio}% of CI` : "N/A"}`);
  lines.push(`  Avg saved minutes:        ${kpi.avgSavedMinutes != null ? `${kpi.avgSavedMinutes} min` : "N/A"}`);
  lines.push(`  Fallback rate:            ${kpi.fallbackRate != null ? `${kpi.fallbackRate}% (${kpi.fallbackRuns})` : "N/A"}`);
  lines.push(`  CI pass when local pass:  ${kpi.passSignal.rate != null ? `${kpi.passSignal.rate}% (${kpi.passSignal.ciPassWhenLocalPass}/${kpi.passSignal.localPassCommits})` : "N/A"}`);
  lines.push(`  CI fail when local fail:  ${kpi.failSignal.rate != null ? `${kpi.failSignal.rate}% (${kpi.failSignal.ciFailWhenLocalFail}/${kpi.failSignal.localFailCommits})` : "N/A"}`);
  lines.push(`  False negatives:          ${kpi.misses.localPassButCiFail}${kpi.misses.falseNegativeRate != null ? ` (${kpi.misses.falseNegativeRate}%)` : ""}`);
  lines.push(`  False positives:          ${kpi.misses.localFailButCiPass}${kpi.misses.falsePositiveRate != null ? ` (${kpi.misses.falsePositiveRate}%)` : ""}`);
  lines.push(`  Confusion matrix:         TP=${kpi.confusionMatrix.truePositive} FP=${kpi.confusionMatrix.falsePositive} FN=${kpi.confusionMatrix.falseNegative} TN=${kpi.confusionMatrix.trueNegative}`);
  lines.push("");

  // Recommendations
  lines.push("## Recommendations");
  for (const recommendation of buildEvalRecommendations(report)) {
    lines.push(`  - ${recommendation}`);
  }

  return lines.join("\n");
}

function formatEvalMarkdownReport(
  report: EvalReport,
  opts: EvalFormatOpts = {},
): string {
  const windowDays = opts.windowDays ?? 30;
  const d = report.dataSufficiency;
  const det = report.detection;
  const res = report.resolution;
  const kpi = report.samplingKpi;
  const recommendations = buildEvalRecommendations(report);

  const lines = [
    `# flaker Review (last ${windowDays} days)`,
    "",
    "## Snapshot",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Health score | ${report.healthScore}/100 (${healthScoreLabel(report.healthScore)}) |`,
    `| Broken tests (100% fail) | ${det.flakyTestDetails?.filter((t) => t.flakyRate >= 100 && t.totalRuns >= 5).length ?? 0} |`,
    `| Flaky tests (intermittent) | ${det.flakyTests - (det.flakyTestDetails?.filter((t) => t.flakyRate >= 100 && t.totalRuns >= 5).length ?? 0)} |`,
    `| Retry flaky (pass+fail in same commit) | ${det.trueFlakyTests} |`,
    `| Matched commits | ${kpi.matchedCommits} |`,
    `| Avg sample ratio | ${kpi.avgSampleRatio != null ? `${kpi.avgSampleRatio}% of CI` : "N/A"} |`,
    `| Avg saved minutes | ${kpi.avgSavedMinutes != null ? `${kpi.avgSavedMinutes} min` : "N/A"} |`,
    `| Fallback rate | ${formatRateValue(kpi.fallbackRate, `${kpi.fallbackRuns}`)} |`,
    `| CI pass when local pass | ${formatRateValue(kpi.passSignal.rate, `${kpi.passSignal.ciPassWhenLocalPass}/${kpi.passSignal.localPassCommits}`)} |`,
    `| CI fail when local fail | ${formatRateValue(kpi.failSignal.rate, `${kpi.failSignal.ciFailWhenLocalFail}/${kpi.failSignal.localFailCommits}`)} |`,
    "",
    "## Data",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Workflow runs | ${d.totalRuns} |`,
    `| Test results | ${d.totalResults} |`,
    `| Unique tests | ${d.uniqueTests} |`,
    `| Avg runs/test | ${d.avgRunsPerTest} |`,
    `| Date range | ${d.firstDate ?? "N/A"} -> ${d.lastDate ?? "N/A"} |`,
    "",
    "## Sampling",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Local-only commits | ${kpi.localOnlyCommits} |`,
    `| CI-only commits | ${kpi.ciOnlyCommits} |`,
    `| Avg local sample size N | ${kpi.avgLocalSampleSize ?? "N/A"} |`,
    `| Median local sample N | ${kpi.medianLocalSampleSize ?? "N/A"} |`,
    `| P95 local sample N | ${kpi.p95LocalSampleSize ?? "N/A"} |`,
    `| Avg CI test count | ${kpi.avgCiTestCount ?? "N/A"} |`,
    `| False negatives | ${kpi.misses.localPassButCiFail}${kpi.misses.falseNegativeRate != null ? ` (${kpi.misses.falseNegativeRate}%)` : ""} |`,
    `| False positives | ${kpi.misses.localFailButCiPass}${kpi.misses.falsePositiveRate != null ? ` (${kpi.misses.falsePositiveRate}%)` : ""} |`,
    `| Confusion matrix | TP=${kpi.confusionMatrix.truePositive} FP=${kpi.confusionMatrix.falsePositive} FN=${kpi.confusionMatrix.falseNegative} TN=${kpi.confusionMatrix.trueNegative} |`,
    "",
    "## Flake Resolution",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Retry flaky tests | ${det.trueFlakyTests} |`,
    `| Quarantined tests | ${det.quarantinedTests} |`,
    `| Resolved flaky | ${res.resolvedFlaky} |`,
    `| New flaky | ${res.newFlaky} |`,
    `| Avg MTTD | ${res.mttdDays != null ? `${res.mttdDays} days` : "N/A"} |`,
    `| Avg MTTR | ${res.mttrDays != null ? `${res.mttrDays} days` : "N/A"} |`,
    "",
    "## Actions",
    "",
  ];

  if (recommendations.length === 0) {
    lines.push("- No immediate action needed.");
  } else {
    lines.push(...recommendations.map((recommendation) => `- ${recommendation}`));
  }

  return lines.join("\n");
}

export function formatEvalReport(
  report: EvalReport,
  format: EvalReportFormat = "text",
  opts: EvalFormatOpts = {},
): string {
  if (format === "markdown") {
    return formatEvalMarkdownReport(report, opts);
  }
  return formatEvalTextReport(report);
}

export function renderEvalReport(
  report: EvalReport,
  opts: EvalRenderOpts = {},
): string {
  if (opts.json && opts.markdown) {
    throw new Error("Cannot render eval report as both JSON and Markdown");
  }
  if (opts.json) {
    return JSON.stringify(report, null, 2);
  }
  if (opts.markdown) {
    return formatEvalReport(report, "markdown", { windowDays: opts.windowDays });
  }
  return formatEvalReport(report, "text", { windowDays: opts.windowDays });
}

export function writeEvalReport(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}
