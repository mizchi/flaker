import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { MetricStore } from "../storage/types.js";
import { loadCore, type MetriciCore } from "../core/loader.js";
import { extractFeatures, FLAKER_FEATURE_NAMES } from "../eval/gbdt.js";

export interface TrainOpts {
  store: MetricStore;
  storagePath: string;
  numTrees?: number;
  learningRate?: number;
  windowDays?: number;
  outputPath?: string;
}

export interface TrainResult {
  modelPath: string;
  trainingRows: number;
  positiveCount: number;
  negativeCount: number;
  numTrees: number;
  learningRate: number;
  ciRows: number;
  localRows: number;
}

export async function trainModel(opts: TrainOpts): Promise<TrainResult> {
  const core = await loadCore();
  const numTrees = opts.numTrees ?? 15;
  const learningRate = opts.learningRate ?? 0.2;
  const windowDays = opts.windowDays ?? 90;

  // Query historical test results with commit context and source info
  const rows = await opts.store.raw<{
    test_id: string | null;
    suite: string;
    test_name: string;
    status: string;
    retry_count: number;
    commit_sha: string;
    source: string;
  }>(`
    SELECT
      COALESCE(tr.test_id, '') AS test_id,
      tr.suite,
      tr.test_name,
      tr.status,
      COALESCE(tr.retry_count, 0)::INTEGER AS retry_count,
      tr.commit_sha,
      COALESCE(wr.source, 'ci') AS source
    FROM test_results tr
    LEFT JOIN workflow_runs wr ON tr.workflow_run_id = wr.id
    WHERE tr.created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(windowDays)} || ' days')
  `);

  // Build per-test aggregates, split by source
  // CI results: authoritative for long-term flaky rate
  // Local results: supplementary signal with reduced weight
  const LOCAL_WEIGHT = 0.5;
  const testAgg = new Map<string, {
    suite: string;
    testName: string;
    runs: number;
    fails: number;
    ciRuns: number;
    ciFails: number;
    localRuns: number;
    localFails: number;
    totalDurationMs: number;
  }>();
  for (const row of rows) {
    const key = row.test_id || `${row.suite}::${row.test_name}`;
    const isLocal = row.source === "local";
    const weight = isLocal ? LOCAL_WEIGHT : 1;
    const agg = testAgg.get(key) ?? {
      suite: row.suite,
      testName: row.test_name,
      runs: 0,
      fails: 0,
      ciRuns: 0,
      ciFails: 0,
      localRuns: 0,
      localFails: 0,
      totalDurationMs: 0,
    };
    agg.runs += weight;
    if (isLocal) {
      agg.localRuns++;
    } else {
      agg.ciRuns++;
    }
    const isFail = row.status === "failed" || row.status === "flaky" ||
        (row.retry_count > 0 && row.status === "passed");
    if (isFail) {
      agg.fails += weight;
      if (isLocal) agg.localFails++;
      else agg.ciFails++;
    }
    testAgg.set(key, agg);
  }

  // Build co-failure data from commit_changes
  const coFailures = await opts.store.queryCoFailures({ windowDays });
  const coFailureMap = new Map<string, number>();
  for (const cf of coFailures) {
    const key = cf.testId || `${cf.suite}::${cf.testName}`;
    const existing = coFailureMap.get(key) ?? 0;
    coFailureMap.set(key, Math.max(existing, cf.coFailureRate));
  }

  // Build training rows: each (commit, test) pair
  const commitTests = new Map<string, Map<string, boolean>>();
  for (const row of rows) {
    const key = row.test_id || `${row.suite}::${row.test_name}`;
    if (!commitTests.has(row.commit_sha)) {
      commitTests.set(row.commit_sha, new Map());
    }
    const tests = commitTests.get(row.commit_sha)!;
    const failed = row.status === "failed" || row.status === "flaky" ||
      (row.retry_count > 0 && row.status === "passed");
    tests.set(key, tests.get(key) || failed);
  }

  const trainingData: { features: number[]; label: number }[] = [];
  for (const [, tests] of commitTests) {
    for (const [testKey, failed] of tests) {
      const agg = testAgg.get(testKey);
      if (!agg) continue;
      const flakyRate = agg.runs > 0 ? (agg.fails / agg.runs) * 100 : 0;
      const features = extractFeatures({
        flaky_rate: flakyRate,
        co_failure_boost: coFailureMap.get(testKey) ?? 0,
        total_runs: agg.runs,
        fail_count: agg.fails,
        avg_duration_ms: agg.runs > 0 ? Math.round(agg.totalDurationMs / agg.runs) : 0,
        previously_failed: agg.fails > 0,
        is_new: agg.runs <= 1,
      });
      trainingData.push({ features, label: failed ? 1 : 0 });
    }
  }

  if (trainingData.length === 0) {
    throw new Error("No training data available. Run `flaker collect` first to gather test results.");
  }

  const model = core.trainGBDT(trainingData, numTrees, learningRate);
  // Add feature names to the model
  const modelWithNames = {
    ...(model as Record<string, unknown>),
    featureNames: FLAKER_FEATURE_NAMES,
    feature_names: FLAKER_FEATURE_NAMES,
  };

  const modelPath = opts.outputPath ?? resolve(dirname(opts.storagePath), "models", "gbdt.json");
  mkdirSync(dirname(modelPath), { recursive: true });
  writeFileSync(modelPath, JSON.stringify(modelWithNames, null, 2));

  const positiveCount = trainingData.filter((d) => d.label === 1).length;
  const ciRows = rows.filter((r) => r.source !== "local").length;
  const localRows = rows.filter((r) => r.source === "local").length;

  return {
    modelPath,
    trainingRows: trainingData.length,
    positiveCount,
    negativeCount: trainingData.length - positiveCount,
    numTrees,
    learningRate,
    ciRows,
    localRows,
  };
}

export function formatTrainResult(result: TrainResult): string {
  const lines = [
    "# GBDT Training Complete",
    "",
    `  Training rows:    ${result.trainingRows}`,
    `  Positive (fail):  ${result.positiveCount}`,
    `  Negative (pass):  ${result.negativeCount}`,
    `  Source:            ${result.ciRows} CI + ${result.localRows} local (weight 0.5)`,
    `  Trees:            ${result.numTrees}`,
    `  Learning rate:    ${result.learningRate}`,
    `  Model saved to:   ${result.modelPath}`,
  ];
  return lines.join("\n");
}
