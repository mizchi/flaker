import type { MetricStore } from "../../storage/types.js";
import { dataConfidence, historyCounts, testHealth, type DataConfidence } from "../../datasets/facts.js";
import { runHoldoutKpi, runSamplingKpi } from "./eval.js";

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
    confidence: DataConfidence;
    /** ISO date of most recent test result */
    lastDataAt: string | null;
    /** Days since last data */
    staleDays: number | null;
  };
}

export async function computeKpi(
  store: MetricStore,
  opts?: { windowDays?: number; now?: Date },
): Promise<FlakerKpi> {
  const window = opts?.windowDays ?? 30;
  const now = opts?.now ?? new Date();
  const cutoff = new Date(now.getTime() - window * 24 * 60 * 60 * 1000);
  const cutoffLiteral = cutoff.toISOString().replace("T", " ").replace("Z", "");

  // --- Sampling: one engine (MoonBit build_sampling_kpi, commit level) ---
  // A matched commit has a local sampled run and a CI run with results. The
  // confusion matrix counts commits: did the local run fail, did CI fail.
  const [samplingKpi, holdout] = await Promise.all([
    runSamplingKpi({ store, windowDays: window, now }),
    runHoldoutKpi({ store, windowDays: window, now }),
  ]);
  const matched = samplingKpi.matchedCommits;
  const { truePositive: tp, falsePositive: fp, falseNegative: fn, trueNegative: tn } = samplingKpi.confusionMatrix;
  const pct = (num: number, den: number, empty: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : empty);
  const recall = matched > 0 ? pct(tp, tp + fn, 100) : null;
  const falsePositiveRate = matched > 0 ? pct(fp, fp + tn, 0) : null;
  const falseNegativeRate = matched > 0 ? (samplingKpi.misses.falseNegativeRate ?? 0) : null;
  const passCorrelation = matched > 0 ? (samplingKpi.passSignal.rate ?? 100) : null;

  // --- Flaky (flaker_v1.flaky over this window and the one before) ---
  const health = await testHealth(store, { windowDays: window, now });
  const previous = await testHealth(store, { windowDays: window, now: cutoff });
  const totalClassified = health.classified || 1;
  const intermittent = health.flaky;

  // --- Data quality ---
  const history = await historyCounts(store, { windowDays: window, now });
  const [dataRow] = await store.raw<{
    commits_with_changes: number;
    last_data_at: string | null;
  }>(`
    SELECT
      (SELECT COUNT(DISTINCT commit_sha)::INTEGER FROM commit_changes
       WHERE commit_sha IN (
         SELECT DISTINCT commit_sha FROM test_results
         WHERE created_at > '${cutoffLiteral}'::TIMESTAMP
       )) AS commits_with_changes,
      (SELECT MAX(created_at)::VARCHAR FROM test_results) AS last_data_at
  `);

  const commitCount = history.commits;
  const commitsWithChanges = dataRow?.commits_with_changes ?? 0;
  const coFailureCoverage = commitCount > 0 ? commitsWithChanges / commitCount : 0;
  const confidence = dataConfidence(commitCount);

  return {
    timestamp: new Date().toISOString(),
    windowDays: window,
    sampling: {
      matchedCommits: matched,
      recall,
      falsePositiveRate,
      falseNegativeRate,
      sampleRatio: samplingKpi.avgSampleRatio,
      passCorrelation,
      holdoutFNR: holdout.falseNegativeRate,
      skippedMinutes: samplingKpi.avgSavedMinutes,
      confusionMatrix: matched > 0 ? { truePositive: tp, falsePositive: fp, falseNegative: fn, trueNegative: tn } : null,
    },
    flaky: {
      brokenTests: health.broken,
      intermittentFlaky: intermittent,
      trueFlakyRate: Math.round((intermittent / totalClassified) * 1000) / 10,
      flakyTrend: (health.flaky + health.broken) - (previous.flaky + previous.broken),
    },
    data: {
      commitCount,
      commitsWithChanges,
      coFailureCoverage: Math.round(coFailureCoverage * 1000) / 10,
      coFailureReady: coFailureCoverage >= 0.8,
      confidence,
      lastDataAt: dataRow?.last_data_at ?? null,
      staleDays: dataRow?.last_data_at
        ? Math.floor((now.getTime() - new Date(dataRow.last_data_at).getTime()) / 86400000)
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
    lines.push(`  (No CI overlap yet — run \`flaker import --ci\` after \`flaker run\` to validate)`);
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
      lines.push(`  Last data:        ${kpi.data.lastDataAt.slice(0, 10)} (${stale} days ago — stale, run \`flaker import --ci\`)`);
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
    steps.push(`Fix or quarantine: \`flaker status --list flaky\``);
  }
  if (s.matchedCommits > 0 && s.falseNegativeRate != null && s.falseNegativeRate > 5) {
    issues.push(`high false negative rate (${s.falseNegativeRate}%)`);
    steps.push("Increase sample percentage or switch to hybrid strategy");
  }
  if (kpi.data.confidence === "insufficient" || kpi.data.confidence === "low") {
    issues.push(`${kpi.data.confidence} data (${kpi.data.commitCount} commits)`);
    steps.push(`Collect more: \`flaker import --ci --days 30\``);
  }
  if (!kpi.data.coFailureReady) {
    issues.push("co-failure data incomplete");
    steps.push("Ensure `flaker import --ci` runs with GITHUB_TOKEN");
  }
  if (kpi.data.staleDays != null && kpi.data.staleDays > 7) {
    issues.push(`data is ${kpi.data.staleDays} days old`);
    steps.push(`Refresh: \`flaker import --ci --days 7\``);
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
