import type { MetricStore } from "../storage/types.js";
import type { FixtureData } from "./fixture-generator.js";
import type { DependencyResolver } from "../resolvers/types.js";
import { planSample } from "../commands/sample.js";

function createFixtureResolver(fixture: FixtureData): DependencyResolver {
  return {
    resolve(changedFiles: string[], allTestFiles: string[]): string[] {
      const allTestSet = new Set(allTestFiles);
      const affected = new Set<string>();
      for (const file of changedFiles) {
        const deps = fixture.fileDeps.get(file);
        if (deps) {
          for (const suite of deps) {
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
}

export async function evaluateFixture(
  store: MetricStore,
  fixture: FixtureData,
): Promise<EvalStrategyResult[]> {
  const resolver = createFixtureResolver(fixture);
  const strategies = [
    { name: "random", mode: "random" as const, useCoFailure: false, useResolver: false },
    { name: "weighted", mode: "weighted" as const, useCoFailure: false, useResolver: false },
    { name: "weighted+co-failure", mode: "weighted" as const, useCoFailure: true, useResolver: false },
    { name: "hybrid+co-failure", mode: "hybrid" as const, useCoFailure: true, useResolver: true },
  ];

  // Use last 25% of commits as evaluation set
  const evalStart = Math.floor(fixture.commits.length * 0.75);
  const evalCommits = fixture.commits.slice(evalStart);
  const sampleCount = Math.round(
    fixture.tests.length * (fixture.config.samplePercentage / 100),
  );

  const results: EvalStrategyResult[] = [];

  for (const strategy of strategies) {
    let totalFailures = 0;
    let detectedFailures = 0;
    let totalSampled = 0;
    let totalSampledFailures = 0;

    for (const commit of evalCommits) {
      const changedFiles = strategy.useCoFailure
        ? commit.changedFiles.map((f) => f.filePath)
        : undefined;

      const plan = await planSample({
        store,
        count: sampleCount,
        mode: strategy.mode,
        seed: 42,
        changedFiles,
        resolver: strategy.useResolver ? resolver : undefined,
      });

      const sampledSuites = new Set(plan.sampled.map((t) => t.suite));
      const actualFailures = commit.testResults.filter((r) => r.status === "failed");
      const detectedInSample = actualFailures.filter((f) => sampledSuites.has(f.suite));

      totalFailures += actualFailures.length;
      detectedFailures += detectedInSample.length;
      totalSampled += plan.sampled.length;
      totalSampledFailures += plan.sampled.filter((t) =>
        commit.testResults.some((r) => r.suite === t.suite && r.status === "failed"),
      ).length;
    }

    const recall = totalFailures > 0 ? detectedFailures / totalFailures : 1;
    const precision = totalSampled > 0 ? totalSampledFailures / totalSampled : 0;
    const f1 = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;
    const sampleRatio = fixture.tests.length > 0 ? sampleCount / fixture.tests.length : 0;
    const efficiency = sampleRatio > 0 ? recall / sampleRatio : 0;

    results.push({
      strategy: strategy.name,
      recall: Math.round(recall * 1000) / 1000,
      precision: Math.round(precision * 1000) / 1000,
      f1: Math.round(f1 * 1000) / 1000,
      falseNegativeRate: Math.round((1 - recall) * 1000) / 1000,
      sampleRatio: Math.round(sampleRatio * 1000) / 1000,
      efficiency: Math.round(efficiency * 100) / 100,
      totalFailures,
      detectedFailures,
      totalSampled,
    });
  }

  return results;
}
