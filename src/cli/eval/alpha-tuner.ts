import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { MetricStore } from "../storage/types.js";
import { planSample } from "../commands/sample.js";
import type { DependencyResolver } from "../resolvers/types.js";

export interface TuningConfig {
  alpha: number;
}

export interface TuningResult {
  alpha: number;
  recall: number;
  precision: number;
  f1: number;
}

const DEFAULT_TUNING: TuningConfig = { alpha: 1.0 };

export function loadTuningConfig(storagePath: string): TuningConfig {
  const tuningPath = resolve(dirname(storagePath), "models", "tuning.json");
  if (!existsSync(tuningPath)) {
    return DEFAULT_TUNING;
  }
  try {
    return JSON.parse(readFileSync(tuningPath, "utf8"));
  } catch {
    return DEFAULT_TUNING;
  }
}

export function saveTuningConfig(storagePath: string, config: TuningConfig): void {
  const modelsDir = resolve(dirname(storagePath), "models");
  mkdirSync(modelsDir, { recursive: true });
  const tuningPath = join(modelsDir, "tuning.json");
  writeFileSync(tuningPath, JSON.stringify(config, null, 2));
}

interface TuneAlphaOpts {
  store: MetricStore;
  changedFilesPerCommit: Map<string, string[]>;
  groundTruth: Map<string, Set<string>>; // commit_sha -> set of failed suites
  allTestSuites: string[];
  sampleCount: number;
  resolver?: DependencyResolver;
  alphaValues?: number[];
}

export async function tuneAlpha(opts: TuneAlphaOpts): Promise<TuningResult[]> {
  const alphas = opts.alphaValues ?? [0, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0];
  const commits = [...opts.changedFilesPerCommit.entries()];
  const results: TuningResult[] = [];

  for (const alpha of alphas) {
    let totalFailures = 0;
    let detectedFailures = 0;
    let totalSampled = 0;
    let totalSampledFailures = 0;

    for (const [commitSha, changedFiles] of commits) {
      const failedSuites = opts.groundTruth.get(commitSha) ?? new Set();

      const plan = await planSample({
        store: opts.store,
        count: opts.sampleCount,
        mode: opts.resolver ? "hybrid" : "weighted",
        seed: 42,
        changedFiles,
        resolver: opts.resolver,
        coFailureAlpha: alpha,
      });

      const sampledSuites = new Set(plan.sampled.map((t) => t.suite));

      totalFailures += failedSuites.size;
      for (const suite of failedSuites) {
        if (sampledSuites.has(suite)) detectedFailures++;
      }
      totalSampled += plan.sampled.length;
      for (const t of plan.sampled) {
        if (failedSuites.has(t.suite)) totalSampledFailures++;
      }
    }

    const recall = totalFailures > 0 ? detectedFailures / totalFailures : 1;
    const precision = totalSampled > 0 ? totalSampledFailures / totalSampled : 0;
    const f1 = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;

    results.push({
      alpha,
      recall: Math.round(recall * 1000) / 1000,
      precision: Math.round(precision * 1000) / 1000,
      f1: Math.round(f1 * 1000) / 1000,
    });
  }

  return results;
}

export function findBestAlpha(results: TuningResult[]): TuningResult {
  return results.reduce((best, r) => (r.f1 > best.f1 ? r : best), results[0]);
}

export function formatTuningReport(results: TuningResult[]): string {
  const best = findBestAlpha(results);
  const lines = [
    "# Alpha Tuning Results",
    "",
    "| Alpha  | Recall | Precision | F1     |",
    "|--------|--------|-----------|--------|",
  ];

  for (const r of results) {
    const marker = r.alpha === best.alpha ? " *" : "";
    lines.push(
      `| ${r.alpha.toFixed(2).padEnd(6)} | ${(r.recall * 100).toFixed(1).padStart(5)}% | ${(r.precision * 100).toFixed(1).padStart(8)}% | ${r.f1.toFixed(3).padStart(6)} |${marker}`,
    );
  }

  lines.push("", `Best alpha: ${best.alpha} (F1=${best.f1.toFixed(3)})`);
  return lines.join("\n");
}
