import type { MetricStore } from "../../storage/types.js";
import type { SamplingConfig } from "../../config.js";

export interface ProjectProfile {
  testCount: number;
  flakyRate: number;
  /** Flaky rate excluding always-failing tests (true intermittent rate). */
  trueFlakyRate: number;
  coFailureStrength: number;
  /** Whether co-failure data actually exists (vs default). */
  hasCoFailureData: boolean;
  commitCount: number;
  hasResolver: boolean;
  hasGBDTModel: boolean;
  /** Tests that fail 100% of runs — broken, not flaky. */
  brokenTestCount: number;
  /** Tests with intermittent failures (0 < failRate < 100%). */
  intermittentFlakyCount: number;
  /** Data sufficiency level. */
  confidence: "insufficient" | "low" | "moderate" | "high";
}

export interface CalibrationResult {
  profile: ProjectProfile;
  sampling: SamplingConfig;
}

/**
 * Analyze project characteristics from historical data.
 */
export async function analyzeProject(
  store: MetricStore,
  opts: { hasResolver: boolean; hasGBDTModel: boolean; windowDays?: number },
): Promise<ProjectProfile> {
  const window = opts.windowDays ?? 90;

  const testCountRows = await store.raw<{ cnt: number }>(`
    SELECT COUNT(DISTINCT tr.suite || '::' || tr.test_name) AS cnt
    FROM test_results tr
    JOIN workflow_runs wr ON tr.workflow_run_id = wr.id
    WHERE tr.created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
      AND COALESCE(wr.source, 'ci') = 'ci'
  `);
  const testCount = Number(testCountRows[0]?.cnt ?? 0);

  // Classify tests: broken (100% fail) vs intermittent flaky vs stable
  const classRows = await store.raw<{
    broken_count: number;
    intermittent_count: number;
    total_failing: number;
    total_count: number;
  }>(`
    SELECT
      COUNT(DISTINCT CASE WHEN fail_rate >= 100 THEN key END) AS broken_count,
      COUNT(DISTINCT CASE WHEN fail_rate > 0 AND fail_rate < 100 THEN key END) AS intermittent_count,
      COUNT(DISTINCT CASE WHEN fail_rate > 0 THEN key END) AS total_failing,
      COUNT(DISTINCT key) AS total_count
    FROM (
      SELECT
        tr.suite || '::' || tr.test_name AS key,
        COUNT(*) AS runs,
        ROUND(COUNT(*) FILTER (WHERE tr.status IN ('failed', 'flaky')) * 100.0 / COUNT(*), 1) AS fail_rate
      FROM test_results tr
      JOIN workflow_runs wr ON tr.workflow_run_id = wr.id
      WHERE tr.created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
        AND COALESCE(wr.source, 'ci') = 'ci'
      GROUP BY tr.suite, tr.test_name
      HAVING COUNT(*) >= 5
    ) sub
  `);
  const brokenTestCount = Number(classRows[0]?.broken_count ?? 0);
  const intermittentFlakyCount = Number(classRows[0]?.intermittent_count ?? 0);
  const totalFailing = Number(classRows[0]?.total_failing ?? 0);
  const totalClassified = Number(classRows[0]?.total_count ?? 1);

  const flakyRate = totalClassified > 0 ? totalFailing / totalClassified : 0;
  const trueFlakyRate = totalClassified > 0 ? intermittentFlakyCount / totalClassified : 0;

  // Co-failure data
  let coFailureStrength = 0.5;
  let hasCoFailureData = false;
  try {
    const coRows = await store.raw<{ cnt: number }>(`
      SELECT COUNT(*) AS cnt FROM commit_changes LIMIT 1
    `);
    if (Number(coRows[0]?.cnt ?? 0) > 0) {
      hasCoFailureData = true;
      const corrRows = await store.raw<{ avg_co_fail: number }>(`
        SELECT COALESCE(AVG(co_fail_rate), 0) AS avg_co_fail
        FROM (
          SELECT
            cc.file_path,
            tr.suite || '::' || tr.test_name AS test_key,
            COUNT(*) AS co_runs,
            SUM(CASE WHEN tr.status IN ('failed', 'flaky') THEN 1 ELSE 0 END) AS co_fails,
            CASE WHEN COUNT(*) >= 3
              THEN CAST(SUM(CASE WHEN tr.status IN ('failed', 'flaky') THEN 1 ELSE 0 END) AS DOUBLE) / COUNT(*)
              ELSE 0 END AS co_fail_rate
          FROM commit_changes cc
          JOIN test_results tr ON cc.commit_sha = tr.commit_sha
          WHERE tr.created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
          GROUP BY cc.file_path, test_key
          HAVING co_runs >= 3 AND co_fails > 0
        ) sub
      `);
      coFailureStrength = Math.min(1, Number(corrRows[0]?.avg_co_fail ?? 0));
    }
  } catch {
    // commit_changes table may not exist
  }

  const commitRows = await store.raw<{ cnt: number }>(`
    SELECT COUNT(DISTINCT commit_sha) AS cnt
    FROM test_results
    WHERE created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
      AND commit_sha IS NOT NULL
  `);
  const commitCount = Number(commitRows[0]?.cnt ?? 0);

  // Confidence level
  let confidence: ProjectProfile["confidence"];
  if (commitCount < 5) confidence = "insufficient";
  else if (commitCount < 30) confidence = "low";
  else if (commitCount < 100) confidence = "moderate";
  else confidence = "high";

  return {
    testCount,
    flakyRate: Math.round(flakyRate * 1000) / 1000,
    trueFlakyRate: Math.round(trueFlakyRate * 1000) / 1000,
    coFailureStrength: Math.round(coFailureStrength * 100) / 100,
    hasCoFailureData,
    commitCount,
    hasResolver: opts.hasResolver,
    hasGBDTModel: opts.hasGBDTModel,
    brokenTestCount,
    intermittentFlakyCount,
    confidence,
  };
}

/**
 * Determine optimal sampling parameters from project profile.
 */
export function recommendSampling(profile: ProjectProfile): SamplingConfig {
  const now = new Date().toISOString().slice(0, 10);

  let strategy: string;
  if (profile.testCount < 50) {
    strategy = "random";
  } else if (profile.hasResolver && profile.trueFlakyRate < 0.20) {
    strategy = "hybrid";
  } else if (profile.hasGBDTModel && profile.commitCount >= 100 && profile.trueFlakyRate >= 0.15) {
    strategy = "gbdt";
  } else if (profile.hasResolver) {
    strategy = "hybrid";
  } else {
    strategy = profile.hasGBDTModel && profile.commitCount >= 100 ? "gbdt" : "weighted";
  }

  let percentage: number;
  if (profile.testCount < 100) {
    percentage = 50;
  } else if (profile.testCount < 500) {
    percentage = 30;
  } else {
    percentage = 20;
  }

  const holdoutRatio = 0.1;
  const coFailureDays = profile.trueFlakyRate > 0.15 ? 60 : 90;

  return {
    strategy,
    sample_percentage: percentage,
    holdout_ratio: holdoutRatio,
    co_failure_window_days: coFailureDays,
    calibrated_at: now,
    detected_flaky_rate_ratio: profile.trueFlakyRate,
    detected_co_failure_strength_ratio: profile.coFailureStrength,
    detected_test_count: profile.testCount,
  };
}

/**
 * Format calibration result for display.
 */
export function formatCalibrationReport(result: CalibrationResult): string {
  const { profile: p, sampling: s } = result;
  const lines: string[] = [];

  // Data sufficiency warning
  if (p.confidence === "insufficient") {
    lines.push("⚠ Insufficient data (< 5 commits). Recommendations are unreliable.");
    lines.push("  Run `flaker collect --last 30` to gather more history.");
    lines.push("");
  } else if (p.confidence === "low") {
    lines.push("⚠ Low confidence (" + p.commitCount + " commits). Collect 50+ for reliable calibration.");
    lines.push("");
  }

  lines.push("# Project Profile");
  lines.push("");
  lines.push(`  Tests:              ${p.testCount}`);
  lines.push(`  Commits:            ${p.commitCount} (confidence: ${p.confidence})`);

  // Broken vs flaky distinction
  if (p.brokenTestCount > 0) {
    lines.push(`  Broken tests:       ${p.brokenTestCount} (100% fail rate — fix or quarantine these)`);
  }
  if (p.intermittentFlakyCount > 0) {
    lines.push(`  Flaky tests:        ${p.intermittentFlakyCount} (intermittent failures)`);
  }
  lines.push(`  True flaky rate:    ${(p.trueFlakyRate * 100).toFixed(1)}% (excluding broken tests)`);

  if (!p.hasCoFailureData) {
    lines.push(`  Co-failure data:    none (using default estimate)`);
  } else {
    lines.push(`  Co-failure strength: ${p.coFailureStrength.toFixed(2)}`);
  }

  lines.push(`  Resolver:           ${p.hasResolver ? "yes" : "no"}`);
  lines.push(`  GBDT model:         ${p.hasGBDTModel ? "yes" : "no"}`);

  lines.push("");
  lines.push("## Recommended [sampling] config");
  lines.push(`  strategy              = "${s.strategy}"    # ${strategyExplanation(s.strategy)}`);
  lines.push(`  sample_percentage     = ${s.sample_percentage}              # run ${s.sample_percentage}% of tests`);
  lines.push(`  holdout_ratio         = ${s.holdout_ratio}           # randomly verify ${(s.holdout_ratio! * 100).toFixed(0)}% of skipped tests`);
  lines.push(`  co_failure_window_days = ${s.co_failure_window_days}`);

  // Priority actions
  lines.push("");
  lines.push("## Next steps");
  if (p.brokenTestCount > 0) {
    lines.push(`  1. Fix or quarantine ${p.brokenTestCount} broken test(s) — they inflate flaky metrics`);
  }
  if (p.confidence === "insufficient" || p.confidence === "low") {
    lines.push(`  ${p.brokenTestCount > 0 ? "2" : "1"}. Collect more CI data: \`flaker collect --last 30\``);
    lines.push(`     Then re-run: \`flaker calibrate\``);
  } else {
    lines.push(`  ${p.brokenTestCount > 0 ? "2" : "1"}. Apply config: \`flaker calibrate\` (without --dry-run)`);
    lines.push(`  ${p.brokenTestCount > 0 ? "3" : "2"}. Run tests: \`flaker run\``);
  }
  lines.push("");
  lines.push("Re-calibrate weekly as project characteristics change.");

  return lines.join("\n");
}

function strategyExplanation(strategy: string): string {
  switch (strategy) {
    case "hybrid": return "dependency graph + co-failure + weighted fill";
    case "gbdt": return "ML model ranking";
    case "weighted": return "prioritize by flaky rate + co-failure";
    case "random": return "uniform random (small suite)";
    default: return strategy;
  }
}

/**
 * Generate a JSON context blob for LLM-assisted calibration.
 */
export function buildExplainContext(
  result: CalibrationResult,
  topTests?: { broken: string[]; flaky: string[] },
): Record<string, unknown> {
  const { profile: p, sampling: s } = result;
  return {
    project: {
      testCount: p.testCount,
      commitCount: p.commitCount,
      confidence: p.confidence,
      confidenceThresholds: { insufficient: "<5", low: "<30", moderate: "<100", high: "100+" },
      brokenTests: p.brokenTestCount,
      intermittentFlakyTests: p.intermittentFlakyCount,
      trueFlakyRate: p.trueFlakyRate,
      rawFlakyRate: p.flakyRate,
      coFailureStrength: p.coFailureStrength,
      hasCoFailureData: p.hasCoFailureData,
      hasResolver: p.hasResolver,
      hasGBDTModel: p.hasGBDTModel,
    },
    recommendation: {
      strategy: s.strategy,
      strategyReason: strategyExplanation(s.strategy),
      samplePercentage: s.sample_percentage,
      holdoutRatio: s.holdout_ratio,
      coFailureWindowDays: s.co_failure_window_days,
    },
    topTests: topTests ?? { broken: [], flaky: [] },
    warnings: [
      ...(p.confidence === "insufficient" ? ["Insufficient data (< 5 commits). Recommendations are unreliable."] : []),
      ...(p.confidence === "low" ? [`Low confidence (${p.commitCount} commits). Need 50+ for reliable calibration.`] : []),
      ...(p.brokenTestCount > 0 ? [`${p.brokenTestCount} test(s) fail 100% of the time — these are broken, not flaky.`] : []),
      ...(!p.hasCoFailureData ? ["No co-failure data collected. Co-failure strength is a default estimate."] : []),
    ],
  };
}

/**
 * Query top broken and flaky test names for --explain context.
 */
export async function queryTopTests(
  store: MetricStore,
  windowDays: number,
): Promise<{ broken: string[]; flaky: string[] }> {
  const window = Number(windowDays);
  const rows = await store.raw<{ key: string; fail_rate: number }>(`
    SELECT
      tr.suite || ' > ' || tr.test_name AS key,
      ROUND(COUNT(*) FILTER (WHERE tr.status IN ('failed', 'flaky')) * 100.0 / COUNT(*), 1) AS fail_rate
    FROM test_results tr
    JOIN workflow_runs wr ON tr.workflow_run_id = wr.id
    WHERE tr.created_at > CURRENT_TIMESTAMP - INTERVAL (${window} || ' days')
      AND COALESCE(wr.source, 'ci') = 'ci'
    GROUP BY tr.suite, tr.test_name
    HAVING COUNT(*) >= 5 AND fail_rate > 0
    ORDER BY fail_rate DESC
    LIMIT 20
  `);
  const broken: string[] = [];
  const flaky: string[] = [];
  for (const r of rows) {
    if (r.fail_rate >= 100) broken.push(r.key);
    else flaky.push(r.key);
  }
  return { broken: broken.slice(0, 10), flaky: flaky.slice(0, 10) };
}
