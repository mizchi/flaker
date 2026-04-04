import type { MetricStore } from "../storage/types.js";
import type { SamplingConfig } from "../config.js";

export interface ProjectProfile {
  testCount: number;
  flakyRate: number;
  coFailureStrength: number;
  commitCount: number;
  hasResolver: boolean;
  hasGBDTModel: boolean;
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

  // Count distinct tests (CI only for authoritative count)
  const testCountRows = await store.raw<{ cnt: number }>(`
    SELECT COUNT(DISTINCT tr.suite || '::' || tr.test_name) AS cnt
    FROM test_results tr
    JOIN workflow_runs wr ON tr.workflow_run_id = wr.id
    WHERE tr.created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
      AND COALESCE(wr.source, 'ci') = 'ci'
  `);
  const testCount = Number(testCountRows[0]?.cnt ?? 0);

  // Compute overall flaky rate from CI results only
  const flakyRows = await store.raw<{ flaky_count: number; total_count: number }>(`
    SELECT
      COUNT(DISTINCT CASE WHEN fail_count > 0 THEN key END) AS flaky_count,
      COUNT(DISTINCT key) AS total_count
    FROM (
      SELECT
        tr.suite || '::' || tr.test_name AS key,
        SUM(CASE WHEN tr.status IN ('failed', 'flaky') THEN 1 ELSE 0 END) AS fail_count
      FROM test_results tr
      JOIN workflow_runs wr ON tr.workflow_run_id = wr.id
      WHERE tr.created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
        AND COALESCE(wr.source, 'ci') = 'ci'
      GROUP BY tr.suite, tr.test_name
    ) sub
  `);
  const flakyCount = Number(flakyRows[0]?.flaky_count ?? 0);
  const totalCount = Number(flakyRows[0]?.total_count ?? 1);
  const flakyRate = totalCount > 0 ? flakyCount / totalCount : 0;

  // Estimate co-failure strength: how often do file changes correlate with test failures?
  // Use commit_changes if available, otherwise estimate from test failure clustering
  let coFailureStrength = 0.5; // default mid estimate
  try {
    const coRows = await store.raw<{ cnt: number }>(`
      SELECT COUNT(*) AS cnt FROM commit_changes LIMIT 1
    `);
    if (Number(coRows[0]?.cnt ?? 0) > 0) {
      const corrRows = await store.raw<{ avg_co_fail: number }>(`
        SELECT
          COALESCE(AVG(co_fail_rate), 0) AS avg_co_fail
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
      coFailureStrength = Math.min(1, Number(corrRows[0]?.avg_co_fail ?? 0.5));
    }
  } catch {
    // commit_changes table may not exist
  }

  // Count commits with test data
  const commitRows = await store.raw<{ cnt: number }>(`
    SELECT COUNT(DISTINCT commit_sha) AS cnt
    FROM test_results
    WHERE created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
      AND commit_sha IS NOT NULL
  `);
  const commitCount = Number(commitRows[0]?.cnt ?? 0);

  return {
    testCount,
    flakyRate: Math.round(flakyRate * 1000) / 1000,
    coFailureStrength: Math.round(coFailureStrength * 100) / 100,
    commitCount,
    hasResolver: opts.hasResolver,
    hasGBDTModel: opts.hasGBDTModel,
  };
}

/**
 * Determine optimal sampling parameters from project profile.
 */
export function recommendSampling(profile: ProjectProfile): SamplingConfig {
  const now = new Date().toISOString().slice(0, 10);

  // Strategy selection based on sweep results
  let strategy: string;
  if (profile.testCount < 50) {
    // Too few tests to benefit from smart sampling
    strategy = "random";
  } else if (profile.hasResolver && profile.flakyRate < 0.10) {
    // Low flaky → hybrid dominates across all sweep scenarios
    strategy = "hybrid";
  } else if (profile.hasResolver && profile.flakyRate < 0.20) {
    // Medium flaky → hybrid still generally best, gbdt competitive at high sample%
    strategy = "hybrid";
  } else if (profile.hasGBDTModel && profile.commitCount >= 100 && profile.flakyRate >= 0.15) {
    // High flaky + sufficient training data → GBDT can outperform hybrid
    strategy = "gbdt";
  } else if (profile.hasResolver) {
    // High flaky but no GBDT → hybrid is still safest
    strategy = "hybrid";
  } else {
    // No resolver available
    strategy = profile.hasGBDTModel && profile.commitCount >= 100 ? "gbdt" : "weighted";
  }

  // Sample percentage: scale with test count
  let percentage: number;
  if (profile.testCount < 100) {
    percentage = 50; // small suites, run more
  } else if (profile.testCount < 500) {
    percentage = 30;
  } else {
    percentage = 20;
  }

  // Holdout ratio: always enable for feedback loop
  const holdoutRatio = 0.1;

  // Co-failure window: shorter if high flaky (more recent data is more relevant)
  const coFailureDays = profile.flakyRate > 0.15 ? 60 : 90;

  return {
    strategy,
    percentage,
    holdout_ratio: holdoutRatio,
    co_failure_days: coFailureDays,
    calibrated_at: now,
    detected_flaky_rate: profile.flakyRate,
    detected_co_failure_strength: profile.coFailureStrength,
    detected_test_count: profile.testCount,
  };
}

/**
 * Format calibration result for display.
 */
export function formatCalibrationReport(result: CalibrationResult): string {
  const { profile: p, sampling: s } = result;
  const lines: string[] = [
    "# Calibration Result",
    "",
    "## Project Profile",
    `  Tests:              ${p.testCount}`,
    `  Flaky rate:         ${(p.flakyRate * 100).toFixed(1)}%`,
    `  Co-failure strength: ${p.coFailureStrength.toFixed(2)}`,
    `  Commits (window):   ${p.commitCount}`,
    `  Resolver available: ${p.hasResolver ? "yes" : "no"}`,
    `  GBDT model:         ${p.hasGBDTModel ? "yes" : "no"}`,
    "",
    "## Recommended [sampling] config",
    `  strategy          = "${s.strategy}"`,
    `  percentage        = ${s.percentage}`,
    `  holdout_ratio     = ${s.holdout_ratio}`,
    `  co_failure_days   = ${s.co_failure_days}`,
    "",
    "## Rationale",
  ];

  if (s.strategy === "hybrid") {
    if (p.flakyRate < 0.10) {
      lines.push("  Low flaky rate + resolver → hybrid achieves 95-100% recall in sweep benchmarks.");
    } else {
      lines.push("  Medium-high flaky rate but resolver available → hybrid is the safest default.");
    }
  } else if (s.strategy === "gbdt") {
    lines.push("  High flaky rate + sufficient training data → GBDT outperforms hybrid in this regime.");
  } else if (s.strategy === "weighted") {
    lines.push("  No resolver or GBDT model → weighted with co-failure boost is the best available.");
  } else if (s.strategy === "random") {
    lines.push("  Test suite is small (< 50) → sampling overhead exceeds benefit.");
  }

  lines.push("");
  lines.push("Re-calibrate periodically (weekly recommended) as project characteristics change.");

  return lines.join("\n");
}
