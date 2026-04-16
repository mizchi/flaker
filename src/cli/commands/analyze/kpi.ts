import type { MetricStore } from "../../storage/types.js";
import { workflowRunSourceSql } from "../../run-source.js";

export interface FlakerKpi {
  timestamp: string;
  windowDays: number;
  sampling: {
    /** Matched commits (both local sampling + CI full run on same SHA) */
    matchedCommits: number;
    /** CI failures caught by sampling / total CI failures */
    recall: number | null;
    /** Sampling selected but CI passed (noise) */
    falsePositiveRate: number | null;
    /** CI failed but sampling skipped (missed bugs) */
    falseNegativeRate: number | null;
    /** Fraction of tests selected vs total */
    sampleRatio: number | null;
    /** Local pass → CI pass correlation */
    passCorrelation: number | null;
    /** Holdout false negative rate */
    holdoutFNR: number | null;
    /** Estimated time saved by skipping (minutes) */
    skippedMinutes: number | null;
    /** Confusion matrix */
    confusionMatrix: {
      truePositive: number;
      falsePositive: number;
      falseNegative: number;
      trueNegative: number;
    } | null;
  };
  flaky: {
    brokenTests: number;
    intermittentFlaky: number;
    trueFlakyRate: number;
    flakyTrend: number;
  };
  data: {
    commitCount: number;
    commitsWithChanges: number;
    coFailureCoverage: number;
    coFailureReady: boolean;
    confidence: "insufficient" | "low" | "moderate" | "high";
    /** ISO date of most recent test result */
    lastDataAt: string | null;
    /** Days since last data */
    staleDays: number | null;
  };
}

export async function computeKpi(
  store: MetricStore,
  opts?: { windowDays?: number },
): Promise<FlakerKpi> {
  const window = opts?.windowDays ?? 30;
  const workflowSourceExpr = workflowRunSourceSql("wr");

  // --- Sampling: confusion matrix from matched commits ---
  // A "matched commit" has both a sampling_run (local) and CI test_results
  const [cmRow] = await store.raw<{
    matched: number;
    tp: number;
    fp: number;
    fn_count: number;
    tn: number;
    sample_ratio: number | null;
    skipped_minutes: number | null;
  }>(`
    WITH local_sampling AS (
      SELECT sr.commit_sha,
        sr.selected_count, sr.candidate_count, sr.duration_ms
      FROM sampling_runs sr
      WHERE sr.command_kind = 'run'
        AND sr.created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
    ),
    sampled_tests AS (
      SELECT sr.commit_sha, srt.suite, srt.test_name
      FROM sampling_run_tests srt
      JOIN sampling_runs sr ON srt.sampling_run_id = sr.id
      WHERE sr.command_kind = 'run'
        AND sr.created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
        AND srt.is_holdout = FALSE
    ),
    holdout_tests AS (
      SELECT sr.commit_sha, srt.suite, srt.test_name
      FROM sampling_run_tests srt
      JOIN sampling_runs sr ON srt.sampling_run_id = sr.id
      WHERE sr.command_kind = 'run'
        AND sr.created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
        AND srt.is_holdout = TRUE
    ),
    ci_results AS (
      SELECT tr.commit_sha, tr.suite, tr.test_name, tr.status, tr.duration_ms
      FROM test_results tr
      JOIN workflow_runs wr ON tr.workflow_run_id = wr.id
      WHERE ${workflowSourceExpr} = 'ci'
        AND tr.created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
    ),
    matched_commits AS (
      SELECT DISTINCT ls.commit_sha
      FROM local_sampling ls
      WHERE EXISTS (SELECT 1 FROM ci_results cr WHERE cr.commit_sha = ls.commit_sha)
    ),
    per_test AS (
      SELECT
        cr.commit_sha,
        cr.suite,
        cr.test_name,
        cr.status AS ci_status,
        cr.duration_ms,
        CASE WHEN st.suite IS NOT NULL THEN TRUE ELSE FALSE END AS was_sampled
      FROM ci_results cr
      INNER JOIN matched_commits mc ON cr.commit_sha = mc.commit_sha
      LEFT JOIN sampled_tests st ON cr.commit_sha = st.commit_sha
        AND cr.suite = st.suite AND cr.test_name = st.test_name
      WHERE NOT EXISTS (
        SELECT 1 FROM holdout_tests ht
        WHERE ht.commit_sha = cr.commit_sha
          AND ht.suite = cr.suite AND ht.test_name = cr.test_name
      )
    )
    SELECT
      (SELECT COUNT(DISTINCT commit_sha)::INTEGER FROM matched_commits) AS matched,
      COALESCE(SUM(CASE WHEN was_sampled AND ci_status IN ('failed', 'flaky') THEN 1 ELSE 0 END), 0)::INTEGER AS tp,
      COALESCE(SUM(CASE WHEN was_sampled AND ci_status = 'passed' THEN 1 ELSE 0 END), 0)::INTEGER AS fp,
      COALESCE(SUM(CASE WHEN NOT was_sampled AND ci_status IN ('failed', 'flaky') THEN 1 ELSE 0 END), 0)::INTEGER AS fn_count,
      COALESCE(SUM(CASE WHEN NOT was_sampled AND ci_status = 'passed' THEN 1 ELSE 0 END), 0)::INTEGER AS tn,
      CASE WHEN (SELECT COUNT(*) FROM local_sampling) > 0
        THEN (SELECT ROUND(AVG(selected_count * 100.0 / NULLIF(candidate_count, 0)), 1) FROM local_sampling)
        ELSE NULL END AS sample_ratio,
      COALESCE(
        (SELECT ROUND(SUM(
          CASE WHEN NOT was_sampled THEN duration_ms ELSE 0 END
        ) / 60000.0, 1) FROM per_test),
        NULL
      ) AS skipped_minutes
    FROM per_test
  `);

  const matched = cmRow?.matched ?? 0;
  const tp = cmRow?.tp ?? 0;
  const fp = cmRow?.fp ?? 0;
  const fn = cmRow?.fn_count ?? 0;
  const tn = cmRow?.tn ?? 0;

  const totalCiFailures = tp + fn;
  const totalSampled = tp + fp;
  const totalSkipped = fn + tn;

  let recall: number | null = null;
  let falsePositiveRate: number | null = null;
  let falseNegativeRate: number | null = null;
  let passCorrelation: number | null = null;

  if (matched > 0) {
    recall = totalCiFailures > 0 ? Math.round((tp / totalCiFailures) * 1000) / 10 : 100;
    falsePositiveRate = totalSampled > 0 ? Math.round((fp / totalSampled) * 1000) / 10 : 0;
    falseNegativeRate = totalSkipped > 0 ? Math.round((fn / totalSkipped) * 1000) / 10 : 0;
    // Pass correlation: what fraction of skipped tests actually passed in CI
    passCorrelation = totalSkipped > 0 ? Math.round((tn / totalSkipped) * 1000) / 10 : 100;
  }

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

  // --- Flaky ---
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

  const [trendRow] = await store.raw<{ current_count: number; previous_count: number }>(`
    SELECT
      (SELECT COUNT(DISTINCT suite || '::' || test_name)::INTEGER FROM (
        SELECT suite, test_name, COUNT(*) AS runs,
          COUNT(*) FILTER (WHERE status IN ('failed', 'flaky')) AS fails
        FROM test_results
        WHERE created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
        GROUP BY suite, test_name HAVING runs >= 5 AND fails > 0
      ) sub) AS current_count,
      (SELECT COUNT(DISTINCT suite || '::' || test_name)::INTEGER FROM (
        SELECT suite, test_name, COUNT(*) AS runs,
          COUNT(*) FILTER (WHERE status IN ('failed', 'flaky')) AS fails
        FROM test_results
        WHERE created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window * 2)} || ' days')
          AND created_at <= CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
        GROUP BY suite, test_name HAVING runs >= 5 AND fails > 0
      ) sub) AS previous_count
  `);

  const totalClassified = flakyRow?.total_classified ?? 1;
  const intermittent = flakyRow?.intermittent ?? 0;

  // --- Data quality ---
  const [dataRow] = await store.raw<{
    commit_count: number;
    commits_with_changes: number;
    last_data_at: string | null;
  }>(`
    SELECT
      (SELECT COUNT(DISTINCT commit_sha)::INTEGER FROM test_results
       WHERE created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
         AND commit_sha IS NOT NULL) AS commit_count,
      (SELECT COUNT(DISTINCT commit_sha)::INTEGER FROM commit_changes
       WHERE commit_sha IN (
         SELECT DISTINCT commit_sha FROM test_results
         WHERE created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
       )) AS commits_with_changes,
      (SELECT MAX(created_at)::VARCHAR FROM test_results) AS last_data_at
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
    timestamp: new Date().toISOString(),
    windowDays: window,
    sampling: {
      matchedCommits: matched,
      recall,
      falsePositiveRate,
      falseNegativeRate,
      sampleRatio: cmRow?.sample_ratio ?? null,
      passCorrelation,
      holdoutFNR: holdoutRow?.fnr ?? null,
      skippedMinutes: cmRow?.skipped_minutes ?? null,
      confusionMatrix: matched > 0 ? { truePositive: tp, falsePositive: fp, falseNegative: fn, trueNegative: tn } : null,
    },
    flaky: {
      brokenTests: flakyRow?.broken ?? 0,
      intermittentFlaky: intermittent,
      trueFlakyRate: Math.round((intermittent / totalClassified) * 1000) / 10,
      flakyTrend: (trendRow?.current_count ?? 0) - (trendRow?.previous_count ?? 0),
    },
    data: {
      commitCount,
      commitsWithChanges,
      coFailureCoverage: Math.round(coFailureCoverage * 1000) / 10,
      coFailureReady: coFailureCoverage >= 0.8,
      confidence,
      lastDataAt: dataRow?.last_data_at ?? null,
      staleDays: dataRow?.last_data_at
        ? Math.floor((Date.now() - new Date(dataRow.last_data_at).getTime()) / 86400000)
        : null,
    },
  };
}

export function formatKpi(kpi: FlakerKpi): string {
  const lines: string[] = ["# flaker KPI Dashboard", ""];

  // Sampling
  const s = kpi.sampling;
  if (s.matchedCommits > 0) {
    lines.push("## Sampling Effectiveness");
    lines.push(`  Matched commits:  ${s.matchedCommits} (local+CI on same SHA)`);
    lines.push(`  Recall:           ${s.recall != null ? s.recall + "%" : "N/A"} (CI failures caught)`);
    lines.push(`  False positive:   ${s.falsePositiveRate != null ? s.falsePositiveRate + "%" : "N/A"} (sampled but CI passed)`);
    lines.push(`  False negative:   ${s.falseNegativeRate != null ? s.falseNegativeRate + "%" : "N/A"} (skipped but CI failed)`);
    lines.push(`  Pass correlation: ${s.passCorrelation != null ? s.passCorrelation + "%" : "N/A"} (skipped tests that CI passed)`);
    lines.push(`  Sample ratio:     ${s.sampleRatio != null ? s.sampleRatio + "%" : "N/A"}`);
    lines.push(`  Skipped time:     ${s.skippedMinutes != null ? "~" + s.skippedMinutes + " min saved (estimated from CI durations)" : "N/A"}`);
    lines.push(`  Holdout FNR:      ${s.holdoutFNR != null ? s.holdoutFNR + "%" : "N/A"}`);
    if (s.confusionMatrix) {
      const cm = s.confusionMatrix;
      lines.push(`  Confusion matrix: TP=${cm.truePositive} FP=${cm.falsePositive} FN=${cm.falseNegative} TN=${cm.trueNegative}`);
    }
    lines.push("");
  } else if (s.sampleRatio != null) {
    lines.push("## Sampling");
    lines.push(`  Sample ratio:     ${s.sampleRatio}%`);
    lines.push(`  (No CI overlap yet — run \`flaker collect\` after \`flaker run\` to validate)`);
    lines.push("");
  }

  // Flaky
  lines.push("## Flaky Tracking");
  lines.push(`  Broken tests:     ${kpi.flaky.brokenTests}${kpi.flaky.brokenTests > 0 ? " ← fix or quarantine" : ""}`);
  lines.push(`  Flaky tests:      ${kpi.flaky.intermittentFlaky} (intermittent, >= 5 runs)`);
  lines.push(`  True flaky rate:  ${kpi.flaky.trueFlakyRate}%`);
  const trend = kpi.flaky.flakyTrend;
  lines.push(`  Trend:            ${trend > 0 ? `+${trend} tests (worsening vs prev ${kpi.windowDays} days)` : trend < 0 ? `${trend} tests (improving)` : "stable"}`);

  // Data
  lines.push("");
  lines.push("## Data Quality");
  lines.push(`  Commits:          ${kpi.data.commitCount} (${kpi.data.confidence})`);
  lines.push(`  Co-failure data:  ${kpi.data.commitsWithChanges}/${kpi.data.commitCount} commits (${kpi.data.coFailureCoverage}%)`);
  lines.push(`  Co-failure ready: ${kpi.data.coFailureReady ? "yes" : "no"}`);
  if (kpi.data.lastDataAt) {
    const stale = kpi.data.staleDays ?? 0;
    if (stale > 7) {
      lines.push(`  Last data:        ${kpi.data.lastDataAt.slice(0, 10)} (${stale} days ago — stale, run \`flaker collect\`)`);
    } else {
      lines.push(`  Last data:        ${kpi.data.lastDataAt.slice(0, 10)} (${stale}d ago)`);
    }
  }

  // Issues + next steps
  lines.push("");
  const issues: string[] = [];
  const steps: string[] = [];
  if (kpi.flaky.brokenTests > 0) {
    issues.push(`${kpi.flaky.brokenTests} broken test(s)`);
    steps.push(`Fix or quarantine: \`flaker analyze flaky --top 20\``);
  }
  if (s.matchedCommits > 0 && s.falseNegativeRate != null && s.falseNegativeRate > 5) {
    issues.push(`high false negative rate (${s.falseNegativeRate}%)`);
    steps.push("Increase sample percentage or switch to hybrid strategy");
  }
  if (kpi.data.confidence === "insufficient" || kpi.data.confidence === "low") {
    issues.push(`${kpi.data.confidence} data (${kpi.data.commitCount} commits)`);
    steps.push(`Collect more: \`flaker collect --days 30\``);
  }
  if (!kpi.data.coFailureReady) {
    issues.push("co-failure data incomplete");
    steps.push("Ensure `flaker collect` runs with GITHUB_TOKEN");
  }
  if (kpi.data.staleDays != null && kpi.data.staleDays > 7) {
    issues.push(`data is ${kpi.data.staleDays} days old`);
    steps.push(`Refresh: \`flaker collect --days 7\``);
  }
  if (s.matchedCommits === 0 && s.sampleRatio == null) {
    steps.push(`Start sampling: \`flaker run\``);
  }

  if (issues.length === 0) {
    lines.push("All KPIs healthy.");
  } else {
    lines.push(`Issues: ${issues.join(", ")}`);
    lines.push("");
    lines.push("Next steps:");
    for (let i = 0; i < steps.length; i++) {
      lines.push(`  ${i + 1}. ${steps[i]}`);
    }
  }

  return lines.join("\n");
}
