import type { MetricStore } from "../storage/types.js";
import type { FixtureData } from "../core/loader.js";
import type { DependencyResolver } from "../resolvers/types.js";
import { loadCore, type FlakerCore } from "../core/loader.js";
import { planSample, prepareSamplingMeta } from "../commands/exec/plan.js";

function generateSyntheticCoverage(fixture: FixtureData): { suite: string; test_name: string; edges: string[] }[] {
  return fixture.tests.map((t) => {
    const moduleMatch = t.suite.match(/module_(\d+)/);
    const moduleIdx = moduleMatch ? parseInt(moduleMatch[1]) : 0;
    const edges: string[] = [];
    for (let e = 0; e < 10; e++) {
      edges.push(`src/module_${moduleIdx}.ts:${e}`);
    }
    return { suite: t.suite, test_name: t.test_name, edges };
  });
}

function getChangedEdges(changedFiles: { file_path: string }[]): string[] {
  const edges: string[] = [];
  for (const f of changedFiles) {
    for (let e = 0; e < 10; e++) {
      edges.push(`${f.file_path}:${e}`);
    }
  }
  return edges;
}

function createFixtureResolver(fixture: FixtureData): DependencyResolver {
  return {
    resolve(changedFiles: string[], allTestFiles: string[]): string[] {
      const allTestSet = new Set(allTestFiles);
      const affected = new Set<string>();
      for (const file of changedFiles) {
        const deps = fixture.file_deps.find((d) => d.file === file);
        if (deps) {
          for (const suite of deps.suites) {
            if (allTestSet.has(suite)) {
              affected.add(suite);
            }
          }
        }
      }
      return [...affected];
    },
  };
}

export interface EvalStrategyResult {
  strategy: string;
  recall: number;
  precision: number;
  f1: number;
  falseNegativeRate: number;
  sampleRatio: number;
  efficiency: number;
  totalFailures: number;
  detectedFailures: number;
  totalSampled: number;
  holdoutFNR?: number;
}

export interface SweepConfig {
  testCounts?: number[];
  flakyRates?: number[];
  coFailureStrengths?: number[];
  samplePercentages?: number[];
}

export interface SweepResult {
  params: { testCount: number; flakyRate: number; coFailureStrength: number; samplePercentage: number };
  results: EvalStrategyResult[];
}

export interface EvaluateFixtureOptions {
  strategies?: string[];
}

export async function evaluateFixture(
  store: MetricStore,
  fixture: FixtureData,
  opts: EvaluateFixtureOptions = {},
): Promise<EvalStrategyResult[]> {
  const core = await loadCore();
  const resolver = createFixtureResolver(fixture);
  const samplingMeta = await prepareSamplingMeta(store, [], core);
  const strategyFilter = opts.strategies ? new Set(opts.strategies) : null;
  const strategies = [
    { name: "random", mode: "random" as const, useCoFailure: false, useResolver: false },
    { name: "weighted", mode: "weighted" as const, useCoFailure: false, useResolver: false },
    { name: "weighted+co-failure", mode: "weighted" as const, useCoFailure: true, useResolver: false },
    { name: "hybrid+co-failure", mode: "hybrid" as const, useCoFailure: true, useResolver: true },
  ].filter((strategy) => strategyFilter?.has(strategy.name) ?? true);

  const evalStart = Math.floor(fixture.commits.length * 0.75);
  const evalCommits = fixture.commits.slice(evalStart);
  const sampleCount = Math.round(
    fixture.tests.length * (fixture.config.sample_percentage / 100),
  );

  const results: EvalStrategyResult[] = [];

  for (const strategy of strategies) {
    let totalFailures = 0;
    let detectedFailures = 0;
    let totalSampled = 0;
    let totalSampledFailures = 0;
    const sampledSuitesPerCommit: Set<string>[] = [];

    for (const commit of evalCommits) {
      const changedFiles = strategy.useCoFailure
        ? commit.changed_files.map((f) => f.file_path)
        : undefined;

      const plan = await planSample({
        store,
        count: sampleCount,
        mode: strategy.mode,
        seed: 42,
        changedFiles,
        resolver: strategy.useResolver ? resolver : undefined,
        samplingMeta,
      });

      const sampledSuites = new Set(plan.sampled.map((t) => t.suite));
      sampledSuitesPerCommit.push(sampledSuites);
      const actualFailures = commit.test_results.filter((r) => r.status === "failed");
      const detectedInSample = actualFailures.filter((f) => sampledSuites.has(f.suite));

      totalFailures += actualFailures.length;
      detectedFailures += detectedInSample.length;
      totalSampled += plan.sampled.length;
      totalSampledFailures += plan.sampled.filter((t) =>
        commit.test_results.some((r) => r.suite === t.suite && r.status === "failed"),
      ).length;
    }

    const metrics = computeMetrics(totalFailures, detectedFailures, totalSampled, totalSampledFailures, fixture.tests.length, sampleCount);
    const holdoutFNR = computeHoldoutFNR(fixture, evalCommits, sampledSuitesPerCommit, 0.1);
    results.push({ strategy: strategy.name, ...metrics, holdoutFNR });
  }

  // Coverage-guided strategy (via MoonBit core)
  if (strategyFilter?.has("coverage-guided") ?? true) {
    const coverages = generateSyntheticCoverage(fixture);
    let totalFailures = 0;
    let detectedFailures = 0;
    let totalSampled = 0;
    let totalSampledFailures = 0;
    const sampledSuitesPerCommit: Set<string>[] = [];

    for (const commit of evalCommits) {
      const changedEdges = getChangedEdges(commit.changed_files);
      const cgResult = core.selectByCoverage(coverages, changedEdges, sampleCount);

      const sampledSuites = new Set(cgResult.selected);
      sampledSuitesPerCommit.push(sampledSuites);
      const actualFailures = commit.test_results.filter((r) => r.status === "failed");
      const detectedInSample = actualFailures.filter((f) => sampledSuites.has(f.suite));

      totalFailures += actualFailures.length;
      detectedFailures += detectedInSample.length;
      totalSampled += cgResult.selected.length;
      totalSampledFailures += cgResult.selected.filter((suite) =>
        commit.test_results.some((r) => r.suite === suite && r.status === "failed"),
      ).length;
    }

    const metrics = computeMetrics(totalFailures, detectedFailures, totalSampled, totalSampledFailures, fixture.tests.length, sampleCount);
    const holdoutFNR = computeHoldoutFNR(fixture, evalCommits, sampledSuitesPerCommit, 0.1);
    results.push({ strategy: "coverage-guided", ...metrics, holdoutFNR });
  }

  // GBDT strategy (via MoonBit core): train on first 75% of commits, predict on eval commits
  if (strategyFilter?.has("gbdt") ?? true) {
    const trainCommits = fixture.commits.slice(0, evalStart);

    const fileTestFailures = new Map<string, Map<string, { co: number; fail: number }>>();
    for (const commit of trainCommits) {
      const changedFiles = commit.changed_files.map((f) => f.file_path);
      for (const file of changedFiles) {
        if (!fileTestFailures.has(file)) fileTestFailures.set(file, new Map());
        const fileMap = fileTestFailures.get(file)!;
        for (const tr of commit.test_results) {
          const entry = fileMap.get(tr.suite) ?? { co: 0, fail: 0 };
          entry.co++;
          if (tr.status === "failed") entry.fail++;
          fileMap.set(tr.suite, entry);
        }
      }
    }

    const testAgg = new Map<string, { runs: number; fails: number }>();
    for (const commit of trainCommits) {
      for (const tr of commit.test_results) {
        const agg = testAgg.get(tr.suite) ?? { runs: 0, fails: 0 };
        agg.runs++;
        if (tr.status === "failed") agg.fails++;
        testAgg.set(tr.suite, agg);
      }
    }

    const trainingData: { features: number[]; label: number }[] = [];
    for (const commit of trainCommits) {
      const changedFiles = commit.changed_files.map((f) => f.file_path);
      for (const tr of commit.test_results) {
        const agg = testAgg.get(tr.suite) ?? { runs: 0, fails: 0 };
        const flakyRate = agg.runs > 0 ? (agg.fails / agg.runs) * 100 : 0;
        const maxCoFailRate = computeMaxCoFailRate(fileTestFailures, changedFiles, tr.suite);

        trainingData.push({
          features: [
            flakyRate,
            maxCoFailRate,
            agg.runs,
            agg.fails,
            100,
            agg.fails > 0 ? 1 : 0,
            agg.runs <= 1 ? 1 : 0,
          ],
          label: tr.status === "failed" ? 1 : 0,
        });
      }
    }

    const model = core.trainGBDT(trainingData, 15, 0.2);

    let totalFailures = 0;
    let detectedFailures = 0;
    let totalSampled = 0;
    let totalSampledFailures = 0;
    const sampledSuitesPerCommit: Set<string>[] = [];

    for (const commit of evalCommits) {
      const changedFiles = commit.changed_files.map((f) => f.file_path);

      const scored = fixture.tests.map((t) => {
        const agg = testAgg.get(t.suite) ?? { runs: 0, fails: 0 };
        const flakyRate = agg.runs > 0 ? (agg.fails / agg.runs) * 100 : 0;
        const maxCoFailRate = computeMaxCoFailRate(fileTestFailures, changedFiles, t.suite);
        const features = [
          flakyRate,
          maxCoFailRate,
          agg.runs,
          agg.fails,
          100,
          agg.fails > 0 ? 1 : 0,
          agg.runs <= 1 ? 1 : 0,
        ];
        return { suite: t.suite, score: core.predictGBDT(model, features) };
      });

      scored.sort((a, b) => b.score - a.score);
      const selected = scored.slice(0, sampleCount);
      const sampledSuites = new Set(selected.map((s) => s.suite));
      sampledSuitesPerCommit.push(sampledSuites);

      const actualFailures = commit.test_results.filter((r) => r.status === "failed");
      const detectedInSample = actualFailures.filter((f) => sampledSuites.has(f.suite));

      totalFailures += actualFailures.length;
      detectedFailures += detectedInSample.length;
      totalSampled += selected.length;
      totalSampledFailures += selected.filter((s) =>
        commit.test_results.some((r) => r.suite === s.suite && r.status === "failed"),
      ).length;
    }

    const metrics = computeMetrics(totalFailures, detectedFailures, totalSampled, totalSampledFailures, fixture.tests.length, sampleCount);
    const holdoutFNR = computeHoldoutFNR(fixture, evalCommits, sampledSuitesPerCommit, 0.1);
    results.push({ strategy: "gbdt", ...metrics, holdoutFNR });
  }

  return results;
}

export async function runSweep(
  baseConfig: import("../core/loader.js").FixtureConfig,
  sweep: SweepConfig,
  createStore: () => Promise<{ store: MetricStore; close: () => Promise<void> }>,
): Promise<SweepResult[]> {
  const core = await loadCore();
  const testCounts = sweep.testCounts ?? [baseConfig.test_count];
  const flakyRates = sweep.flakyRates ?? [baseConfig.flaky_rate];
  const coFailureStrengths = sweep.coFailureStrengths ?? [baseConfig.co_failure_strength];
  const samplePercentages = sweep.samplePercentages ?? [baseConfig.sample_percentage];

  const results: SweepResult[] = [];
  for (const testCount of testCounts) {
    for (const flakyRate of flakyRates) {
      for (const coFailureStrength of coFailureStrengths) {
        for (const samplePercentage of samplePercentages) {
          const config = { ...baseConfig, test_count: testCount, flaky_rate: flakyRate, co_failure_strength: coFailureStrength, sample_percentage: samplePercentage };
          const { store, close } = await createStore();
          try {
            const fixture = core.generateFixture(config);
            const { loadFixtureIntoStore } = await import("./fixture-loader.js");
            await loadFixtureIntoStore(store, fixture);
            const evalResults = await evaluateFixture(store, fixture);
            results.push({
              params: { testCount, flakyRate, coFailureStrength, samplePercentage },
              results: evalResults,
            });
          } finally {
            await close();
          }
        }
      }
    }
  }
  return results;
}

function computeMetrics(
  totalFailures: number,
  detectedFailures: number,
  totalSampled: number,
  totalSampledFailures: number,
  testCount: number,
  sampleCount: number,
): Omit<EvalStrategyResult, "strategy" | "holdoutFNR"> {
  const recall = totalFailures > 0 ? detectedFailures / totalFailures : 1;
  const precision = totalSampled > 0 ? totalSampledFailures / totalSampled : 0;
  const f1 = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;
  const sampleRatio = testCount > 0 ? sampleCount / testCount : 0;
  const efficiency = sampleRatio > 0 ? recall / sampleRatio : 0;
  return {
    recall: Math.round(recall * 1000) / 1000,
    precision: Math.round(precision * 1000) / 1000,
    f1: Math.round(f1 * 1000) / 1000,
    falseNegativeRate: Math.round((1 - recall) * 1000) / 1000,
    sampleRatio: Math.round(sampleRatio * 1000) / 1000,
    efficiency: Math.round(efficiency * 100) / 100,
    totalFailures,
    detectedFailures,
    totalSampled,
  };
}

function computeHoldoutFNR(
  fixture: FixtureData,
  evalCommits: FixtureData["commits"],
  sampledSuitesPerCommit: Set<string>[],
  holdoutRatio: number,
): number {
  if (holdoutRatio <= 0) return 0;
  let holdoutFailures = 0;
  let holdoutTotal = 0;

  for (let i = 0; i < evalCommits.length; i++) {
    const commit = evalCommits[i];
    const sampledSuites = sampledSuitesPerCommit[i];
    const skipped = fixture.tests.filter((t) => !sampledSuites.has(t.suite));
    const holdoutCount = Math.max(1, Math.round(skipped.length * holdoutRatio));
    const holdoutSuites = new Set(skipped.slice(0, holdoutCount).map((t) => t.suite));

    for (const tr of commit.test_results) {
      if (holdoutSuites.has(tr.suite)) {
        holdoutTotal++;
        if (tr.status === "failed") holdoutFailures++;
      }
    }
  }

  return holdoutTotal > 0 ? Math.round((holdoutFailures / holdoutTotal) * 1000) / 1000 : 0;
}

function computeMaxCoFailRate(
  fileTestFailures: Map<string, Map<string, { co: number; fail: number }>>,
  changedFiles: string[],
  suite: string,
): number {
  let max = 0;
  for (const file of changedFiles) {
    const entry = fileTestFailures.get(file)?.get(suite);
    if (entry && entry.co >= 2) {
      max = Math.max(max, (entry.fail / entry.co) * 100);
    }
  }
  return max;
}
