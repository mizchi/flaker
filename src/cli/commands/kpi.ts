import type { MetricStore } from "../storage/types.js";

export interface FlakerKpi {
  // Sampling effectiveness
  sampling: {
    /** CI failures detected by sampling selection (matched commits only) */
    recall: number | null;
    /** Fraction of tests selected vs total */
    sampleRatio: number | null;
    /** Estimated time saved (minutes) */
    timeSavedMinutes: number | null;
    /** Holdout false negative rate */
    holdoutFNR: number | null;
    /** Number of commits with both local sampling + CI results */
    matchedCommits: number;
  };
  // Flaky tracking
  flaky: {
    /** Tests that fail 100% (broken, not flaky) */
    brokenTests: number;
    /** Tests with intermittent failures */
    intermittentFlaky: number;
    /** True flaky rate (excluding broken) */
    trueFlakyRate: number;
    /** Trend: flaky count change vs previous window */
    flakyTrend: number;
  };
  // Co-failure & data quality
  data: {
    /** Total commits with test data */
    commitCount: number;
    /** Commits that have commit_changes data */
    commitsWithChanges: number;
    /** Coverage: fraction of commits with change data */
    coFailureCoverage: number;
    /** Whether co-failure data is sufficient (coverage > 80%) */
    coFailureReady: boolean;
    /** Confidence level */
    confidence: "insufficient" | "low" | "moderate" | "high";
  };
}

export async function computeKpi(
  store: MetricStore,
  opts?: { windowDays?: number },
): Promise<FlakerKpi> {
  const window = opts?.windowDays ?? 30;

  // --- Sampling effectiveness ---
  const [samplingRow] = await store.raw<{
    matched: number;
    recall: number | null;
    sample_ratio: number | null;
    saved_minutes: number | null;
  }>(`
    WITH local_runs AS (
      SELECT DISTINCT sr.commit_sha, sr.selected_count, sr.candidate_count, sr.duration_ms
      FROM sampling_runs sr
      WHERE sr.command_kind = 'run'
        AND sr.created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
    ),
    ci_failures AS (
      SELECT tr.commit_sha, tr.suite, tr.test_name
      FROM test_results tr
      JOIN workflow_runs wr ON tr.workflow_run_id = wr.id
      WHERE COALESCE(wr.source, 'ci') = 'ci'
        AND tr.status IN ('failed', 'flaky')
        AND tr.created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
    ),
    matched AS (
      SELECT lr.commit_sha, lr.selected_count, lr.candidate_count, lr.duration_ms
      FROM local_runs lr
      WHERE EXISTS (SELECT 1 FROM ci_failures cf WHERE cf.commit_sha = lr.commit_sha)
    )
    SELECT
      (SELECT COUNT(DISTINCT commit_sha)::INTEGER FROM matched) AS matched,
      NULL::DOUBLE AS recall,
      CASE WHEN (SELECT COUNT(*) FROM local_runs) > 0
        THEN ROUND(AVG(selected_count * 100.0 / NULLIF(candidate_count, 0)), 1)
        ELSE NULL END AS sample_ratio,
      CASE WHEN (SELECT COUNT(*) FROM local_runs) > 0
        THEN ROUND(SUM((candidate_count - selected_count) * COALESCE(duration_ms, 0) / NULLIF(candidate_count, 1)) / 60000.0, 1)
        ELSE NULL END AS saved_minutes
    FROM local_runs
  `);

  // Holdout FNR
  const [holdoutRow] = await store.raw<{ fnr: number | null }>(`
    SELECT CASE WHEN holdout_total > 0
      THEN ROUND(holdout_fails * 100.0 / holdout_total, 1) ELSE NULL END AS fnr
    FROM (
      SELECT
        COUNT(*) FILTER (WHERE srt.is_holdout = TRUE)::INTEGER AS holdout_total,
        COUNT(*) FILTER (WHERE srt.is_holdout = TRUE AND tr.status IN ('failed', 'flaky'))::INTEGER AS holdout_fails
      FROM sampling_run_tests srt
      JOIN sampling_runs sr ON srt.sampling_run_id = sr.id
      LEFT JOIN test_results tr ON tr.suite = srt.suite AND tr.test_name = srt.test_name
        AND tr.commit_sha = sr.commit_sha
      WHERE sr.created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
    ) sub
  `);

  // --- Flaky tracking ---
  const [flakyRow] = await store.raw<{
    broken: number;
    intermittent: number;
    total_classified: number;
  }>(`
    SELECT
      COUNT(DISTINCT CASE WHEN fail_rate >= 100 THEN key END)::INTEGER AS broken,
      COUNT(DISTINCT CASE WHEN fail_rate > 0 AND fail_rate < 100 THEN key END)::INTEGER AS intermittent,
      COUNT(DISTINCT key)::INTEGER AS total_classified
    FROM (
      SELECT
        suite || '::' || test_name AS key,
        ROUND(COUNT(*) FILTER (WHERE status IN ('failed', 'flaky')) * 100.0 / COUNT(*), 1) AS fail_rate
      FROM test_results
      WHERE created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
      GROUP BY suite, test_name
      HAVING COUNT(*) >= 5
    ) sub
  `);

  // Flaky trend (current window vs previous window)
  const [trendRow] = await store.raw<{ current_flaky: number; previous_flaky: number }>(`
    SELECT
      (SELECT COUNT(DISTINCT suite || '::' || test_name)::INTEGER FROM test_results
       WHERE status IN ('failed', 'flaky')
         AND created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')) AS current_flaky,
      (SELECT COUNT(DISTINCT suite || '::' || test_name)::INTEGER FROM test_results
       WHERE status IN ('failed', 'flaky')
         AND created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window * 2)} || ' days')
         AND created_at <= CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')) AS previous_flaky
  `);
  const flakyTrend = (trendRow?.current_flaky ?? 0) - (trendRow?.previous_flaky ?? 0);

  const totalClassified = flakyRow?.total_classified ?? 1;
  const intermittent = flakyRow?.intermittent ?? 0;

  // --- Data quality ---
  const [dataRow] = await store.raw<{
    commit_count: number;
    commits_with_changes: number;
  }>(`
    SELECT
      (SELECT COUNT(DISTINCT commit_sha)::INTEGER FROM test_results
       WHERE created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
         AND commit_sha IS NOT NULL) AS commit_count,
      (SELECT COUNT(DISTINCT commit_sha)::INTEGER FROM commit_changes
       WHERE commit_sha IN (
         SELECT DISTINCT commit_sha FROM test_results
         WHERE created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
       )) AS commits_with_changes
  `);

  const commitCount = dataRow?.commit_count ?? 0;
  const commitsWithChanges = dataRow?.commits_with_changes ?? 0;
  const coFailureCoverage = commitCount > 0 ? commitsWithChanges / commitCount : 0;

  let confidence: FlakerKpi["data"]["confidence"];
  if (commitCount < 5) confidence = "insufficient";
  else if (commitCount < 30) confidence = "low";
  else if (commitCount < 100) confidence = "moderate";
  else confidence = "high";

  return {
    sampling: {
      recall: samplingRow?.recall ?? null,
      sampleRatio: samplingRow?.sample_ratio ?? null,
      timeSavedMinutes: samplingRow?.saved_minutes ?? null,
      holdoutFNR: holdoutRow?.fnr ?? null,
      matchedCommits: samplingRow?.matched ?? 0,
    },
    flaky: {
      brokenTests: flakyRow?.broken ?? 0,
      intermittentFlaky: intermittent,
      trueFlakyRate: Math.round((intermittent / totalClassified) * 1000) / 10,
      flakyTrend,
    },
    data: {
      commitCount,
      commitsWithChanges,
      coFailureCoverage: Math.round(coFailureCoverage * 1000) / 10,
      coFailureReady: coFailureCoverage >= 0.8,
      confidence,
    },
  };
}

export function formatKpi(kpi: FlakerKpi): string {
  const lines: string[] = ["# flaker KPI Dashboard", ""];

  // Sampling
  lines.push("## Sampling Effectiveness");
  if (kpi.sampling.matchedCommits === 0) {
    lines.push("  No matched commits yet (run `flaker run` then `flaker collect`)");
  } else {
    lines.push(`  Recall:           ${kpi.sampling.recall != null ? kpi.sampling.recall + "%" : "N/A (need CI+local overlap)"}`);
    lines.push(`  Sample ratio:     ${kpi.sampling.sampleRatio != null ? kpi.sampling.sampleRatio + "%" : "N/A"}`);
    lines.push(`  Time saved:       ${kpi.sampling.timeSavedMinutes != null ? kpi.sampling.timeSavedMinutes + " min" : "N/A"}`);
    lines.push(`  Holdout FNR:      ${kpi.sampling.holdoutFNR != null ? kpi.sampling.holdoutFNR + "%" : "N/A"}`);
    lines.push(`  Matched commits:  ${kpi.sampling.matchedCommits}`);
  }

  // Flaky
  lines.push("");
  lines.push("## Flaky Tracking");
  lines.push(`  Broken tests:     ${kpi.flaky.brokenTests}${kpi.flaky.brokenTests > 0 ? " ← fix these first" : ""}`);
  lines.push(`  Flaky tests:      ${kpi.flaky.intermittentFlaky}`);
  lines.push(`  True flaky rate:  ${kpi.flaky.trueFlakyRate}%`);
  const trend = kpi.flaky.flakyTrend;
  lines.push(`  Trend:            ${trend > 0 ? "+" + trend + " (worsening)" : trend < 0 ? trend + " (improving)" : "stable"}`);

  // Data
  lines.push("");
  lines.push("## Data Quality");
  lines.push(`  Commits:          ${kpi.data.commitCount} (${kpi.data.confidence})`);
  lines.push(`  Co-failure data:  ${kpi.data.commitsWithChanges}/${kpi.data.commitCount} commits (${kpi.data.coFailureCoverage}%)`);
  lines.push(`  Co-failure ready: ${kpi.data.coFailureReady ? "yes" : "no — need " + Math.ceil(kpi.data.commitCount * 0.8) + "+ commits with changes"}`);

  // Summary
  lines.push("");
  lines.push("## Status");
  const issues: string[] = [];
  if (kpi.flaky.brokenTests > 0) issues.push(`${kpi.flaky.brokenTests} broken test(s)`);
  if (kpi.data.confidence === "insufficient") issues.push("insufficient data");
  if (!kpi.data.coFailureReady) issues.push("co-failure data incomplete");
  if (kpi.sampling.matchedCommits === 0) issues.push("no sampling validation data");

  if (issues.length === 0) {
    lines.push("  All KPIs healthy.");
  } else {
    lines.push(`  Issues: ${issues.join(", ")}`);
  }

  return lines.join("\n");
}
