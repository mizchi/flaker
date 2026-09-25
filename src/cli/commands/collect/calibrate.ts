import type { MetricStore } from "../../storage/types.js";
import { coFailureStrength, dataConfidence, historyCounts, testHealth } from "../../datasets/facts.js";
import type { FlakerConfig, SamplingConfig } from "../../config.js";

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
  opts: { hasResolver: boolean; windowDays?: number; now?: Date },
): Promise<ProjectProfile> {
  const window = opts.windowDays ?? 90;
  const now = opts.now ?? new Date();

  const ci = await historyCounts(store, { windowDays: window, now, source: "ci" });
  const testCount = ci.tests;

  // Classify CI results by flaker_v1.flaky: broken (fails every run, no flake
  // evidence) vs flaky vs other failing tests.
  const health = await testHealth(store, { windowDays: window, now, ciOnly: true });
  const brokenTestCount = health.broken;
  const intermittentFlakyCount = health.flaky;
  const totalClassified = health.classified;
  const flakyRate = totalClassified > 0 ? health.failing / totalClassified : 0;
  const trueFlakyRate = totalClassified > 0 ? intermittentFlakyCount / totalClassified : 0;

  // Co-failure strength: the mean flaker_v1.co_failures strength of pairs seen
  // on at least 3 commits (0.5 before any commit changes are recorded).
  const [changes] = await store.raw<{ cnt: number }>(`SELECT COUNT(*)::INTEGER AS cnt FROM commit_changes`);
  const hasCoFailureData = (changes?.cnt ?? 0) > 0;
  const strength = hasCoFailureData ? await coFailureStrength(store, { windowDays: window, now }) : null;
  const coFailureStrengthValue = hasCoFailureData ? Math.min(1, strength ?? 0) : 0.5;

  const commitCount = (await historyCounts(store, { windowDays: window, now })).commits;
  const confidence = dataConfidence(commitCount);

  return {
    testCount,
    flakyRate: Math.round(flakyRate * 1000) / 1000,
    trueFlakyRate: Math.round(trueFlakyRate * 1000) / 1000,
    coFailureStrength: Math.round(coFailureStrengthValue * 100) / 100,
    hasCoFailureData,
    commitCount,
    hasResolver: opts.hasResolver,
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

  const strategy = profile.hasResolver ? "hybrid" : "weighted";

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
 * Analyze the project and recommend [sampling] in one call. Shared by the
 * top-level `flaker calibrate` command and the `apply` calibrate step so
 * both derive `hasResolver` from config the same way.
 */
export async function calibrateSampling(
  store: MetricStore,
  config: FlakerConfig,
  opts: { windowDays?: number; now?: Date } = {},
): Promise<CalibrationResult> {
  const hasResolver = config.affected.resolver !== "" && config.affected.resolver !== "none";
  const profile = await analyzeProject(store, {
    hasResolver,
    windowDays: opts.windowDays ?? 90,
    now: opts.now,
  });
  const sampling = recommendSampling(profile);
  return { profile, sampling };
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
    lines.push("  Run `flaker import --ci --days 30` to gather more history.");
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
    lines.push(`  ${p.brokenTestCount > 0 ? "2" : "1"}. Collect more CI data: \`flaker import --ci --days 30\``);
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
    case "weighted": return "prioritize by flaky rate + co-failure";
    default: return strategy;
  }
}
