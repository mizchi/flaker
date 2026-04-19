import type { DependencyGraph } from "../graph/types.js";
import {
  buildBitflowDependents,
  matchBitflowTaskPaths,
  parseBitflowWorkflowTasks,
} from "../resolvers/bitflow-workflow.js";
import type {
  DetectInput,
  DetectOutput,
  FixtureConfig,
  FixtureData,
  FlakerCore,
  SamplingHistoryRowInput,
  SamplingListedTestInput,
  TestMeta,
} from "./loader.js";

type CoverageEntry = { suite: string; test_name: string; edges: string[] };

type StableVariantEntryInput = { key: string; value: string };

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function globToRegex(pattern: string): RegExp {
  let out = "^";
  for (let index = 0; index < pattern.length; index++) {
    const current = pattern[index];
    if (current === "*") {
      const next = pattern[index + 1];
      if (next === "*") {
        out += ".*";
        index++;
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (".+?^${}()|[]\\".includes(current)) {
      out += `\\${current}`;
    } else {
      out += current;
    }
  }
  out += "$";
  return new RegExp(out);
}

function matchGlob(pattern: string, target: string): boolean {
  return globToRegex(normalizePath(pattern)).test(normalizePath(target));
}

function clampSampleCount(count: number, total: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(Math.floor(count), total);
}

function weightedPick<T>(
  items: T[],
  count: number,
  seed: number,
  weightOf: (item: T) => number,
): T[] {
  const targetCount = clampSampleCount(count, items.length);
  if (targetCount === 0) return [];

  const rng = mulberry32(seed);
  const pool = [...items];
  const selected: T[] = [];

  while (pool.length > 0 && selected.length < targetCount) {
    const weights = pool.map((item) => {
      const weight = weightOf(item);
      return Number.isFinite(weight) && weight > 0 ? weight : 1;
    });
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = rng() * totalWeight;
    let index = 0;

    for (; index < pool.length; index++) {
      cursor -= weights[index];
      if (cursor <= 0) break;
    }

    const chosenIndex = Math.min(index, pool.length - 1);
    selected.push(pool[chosenIndex]);
    pool.splice(chosenIndex, 1);
  }

  return selected;
}

function sortVariant(
  variant?: StableVariantEntryInput[] | null,
): StableVariantEntryInput[] | null {
  if (!variant || variant.length === 0) return null;
  return [...variant].sort((a, b) => a.key.localeCompare(b.key));
}

function stableIdentityKey(input: {
  suite: string;
  test_name: string;
  task_id?: string | null;
  filter?: string | null;
  variant?: StableVariantEntryInput[] | null;
  test_id?: string | null;
}): string {
  return JSON.stringify([
    input.test_id ?? null,
    input.suite,
    input.test_name,
    input.task_id ?? input.suite,
    input.filter ?? null,
    sortVariant(input.variant),
  ]);
}

function buildSamplingMetaFallback(
  historyRows: SamplingHistoryRowInput[],
  listedTests: SamplingListedTestInput[],
): TestMeta[] {
  const rowsByKey = new Map<string, SamplingHistoryRowInput[]>();
  for (const row of historyRows) {
    const key = stableIdentityKey(row);
    const existing = rowsByKey.get(key);
    if (existing) {
      existing.push(row);
    } else {
      rowsByKey.set(key, [row]);
    }
  }

  return listedTests.map((test) => {
    const rows = rowsByKey.get(stableIdentityKey(test)) ?? [];
    const failishRows = rows.filter(
      (row) =>
        row.status === "failed"
        || row.status === "flaky"
        || (row.status === "passed" && row.retry_count > 0),
    );
    const totalRuns = rows.length;
    const avgDurationMs = totalRuns === 0
      ? 0
      : rows.reduce((sum, row) => sum + row.duration_ms, 0) / totalRuns;
    const lastRunAt = rows.length === 0
      ? new Date(0).toISOString()
      : rows
        .map((row) => row.created_at)
        .sort((a, b) => a.localeCompare(b))
        .at(-1) ?? new Date(0).toISOString();

    return {
      suite: test.suite,
      test_name: test.test_name,
      flaky_rate: totalRuns === 0 ? 0 : Number(((failishRows.length * 100) / totalRuns).toFixed(2)),
      total_runs: totalRuns,
      fail_count: rows.filter((row) => row.status === "failed").length,
      last_run_at: lastRunAt,
      avg_duration_ms: avgDurationMs,
      previously_failed: failishRows.length > 0,
      is_new: totalRuns === 0,
      task_id: test.task_id ?? null,
      filter: test.filter ?? null,
      test_id: test.test_id ?? null,
      co_failure_boost: 0,
    };
  });
}

function detectFlakyFallback(input: DetectInput): DetectOutput {
  const groups = new Map<string, {
    suite: string;
    test_name: string;
    total_runs: number;
    fail_count: number;
    flaky_retry_count: number;
  }>();

  for (const row of input.results) {
    const key = `${row.suite}\0${row.test_name}`;
    const entry = groups.get(key) ?? {
      suite: row.suite,
      test_name: row.test_name,
      total_runs: 0,
      fail_count: 0,
      flaky_retry_count: 0,
    };
    entry.total_runs += 1;
    if (row.status === "failed") {
      entry.fail_count += 1;
    }
    if (row.status === "flaky" || (row.status === "passed" && row.retry_count > 0)) {
      entry.flaky_retry_count += 1;
    }
    groups.set(key, entry);
  }

  const flaky_tests = [...groups.values()]
    .filter((entry) => entry.total_runs >= input.min_runs)
    .map((entry) => {
      const flaky_rate = Number(
        (((entry.fail_count + entry.flaky_retry_count) * 100) / entry.total_runs).toFixed(2),
      );
      return {
        suite: entry.suite,
        test_name: entry.test_name,
        flaky_rate,
        total_runs: entry.total_runs,
        fail_count: entry.fail_count,
        flaky_retry_count: entry.flaky_retry_count,
        is_quarantined: false,
      };
    })
    .filter((entry) => entry.flaky_rate > input.threshold)
    .sort((a, b) => b.flaky_rate - a.flaky_rate || a.suite.localeCompare(b.suite) || a.test_name.localeCompare(b.test_name));

  return { flaky_tests };
}

function sampleRandomFallback(meta: TestMeta[], count: number, seed: number): TestMeta[] {
  const targetCount = clampSampleCount(count, meta.length);
  if (targetCount === 0) return [];
  const rng = mulberry32(seed);
  const shuffled = [...meta];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, targetCount);
}

function sampleWeight(meta: TestMeta): number {
  return 1
    + meta.flaky_rate * 3
    + (meta.previously_failed ? 25 : 0)
    + (meta.is_new ? 10 : 0)
    + (meta.co_failure_boost ?? 0) * 5;
}

function sampleWeightedFallback(meta: TestMeta[], count: number, seed: number): TestMeta[] {
  return weightedPick(meta, count, seed, sampleWeight);
}

function sampleHybridFallback(
  meta: TestMeta[],
  affectedSuites: string[],
  count: number,
  seed: number,
): TestMeta[] {
  const targetCount = clampSampleCount(count, meta.length);
  if (targetCount === 0) return [];
  const affectedSet = new Set(affectedSuites);
  const direct = meta.filter((entry) => affectedSet.has(entry.suite) || affectedSet.has(entry.task_id ?? ""));
  const remaining = meta.filter((entry) => !affectedSet.has(entry.suite) && !affectedSet.has(entry.task_id ?? ""));
  const directSelected = sampleWeightedFallback(direct, Math.min(targetCount, direct.length), seed);
  if (directSelected.length >= targetCount) {
    return directSelected.slice(0, targetCount);
  }
  const fill = sampleWeightedFallback(remaining, targetCount - directSelected.length, seed + 1);
  return [...directSelected, ...fill];
}

function resolveAffectedFallback(workflowText: string, changedPaths: string[]): string[] {
  const tasks = parseBitflowWorkflowTasks(workflowText);
  const direct = new Set<string>();
  for (const task of tasks) {
    if (matchBitflowTaskPaths(task, changedPaths).matchedPaths.length > 0) {
      direct.add(task.id);
    }
  }
  const dependents = buildBitflowDependents(tasks);
  const affected = [...direct];
  const seen = new Set(affected);

  for (let index = 0; index < affected.length; index++) {
    const current = affected[index];
    for (const dependent of dependents.get(current) ?? []) {
      if (seen.has(dependent)) continue;
      seen.add(dependent);
      affected.push(dependent);
    }
  }

  return affected;
}

function buildReverseDepsFallback(graph: DependencyGraph): Map<string, string[]> {
  const reverse = new Map<string, string[]>();
  for (const node of graph.nodes.values()) {
    for (const dependency of node.dependencies) {
      const dependents = reverse.get(dependency) ?? [];
      dependents.push(node.id);
      reverse.set(dependency, dependents);
    }
  }
  for (const dependents of reverse.values()) {
    dependents.sort();
  }
  return reverse;
}

function expandTransitiveFallback(graph: DependencyGraph, initial: Set<string>): string[] {
  const reverse = buildReverseDepsFallback(graph);
  const queue = [...initial];
  const seen = new Set(queue);
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const dependent of reverse.get(current) ?? []) {
      if (seen.has(dependent)) continue;
      seen.add(dependent);
      queue.push(dependent);
    }
  }
  return queue;
}

function findAffectedNodesFallback(graph: DependencyGraph, changedFiles: string[]): string[] {
  const direct = new Set<string>();
  for (const node of graph.nodes.values()) {
    if (
      changedFiles.some((file) =>
        node.sourcePatterns.some((pattern) => matchGlob(pattern, file)),
      )
    ) {
      direct.add(node.id);
    }
  }
  return expandTransitiveFallback(graph, direct);
}

function topologicalSortFallback(graph: DependencyGraph): string[] {
  const inDegree = new Map<string, number>();
  const reverse = buildReverseDepsFallback(graph);
  const order = [...graph.nodes.keys()];
  for (const id of order) {
    inDegree.set(id, graph.nodes.get(id)?.dependencies.length ?? 0);
  }

  const ready = order.filter((id) => (inDegree.get(id) ?? 0) === 0);
  const sorted: string[] = [];

  while (ready.length > 0) {
    const current = ready.shift()!;
    sorted.push(current);
    for (const dependent of reverse.get(current) ?? []) {
      const nextDegree = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, nextDegree);
      if (nextDegree === 0) {
        ready.push(dependent);
      }
    }
  }

  return sorted.length === order.length ? sorted : order;
}

function getAffectedTestPatternsFallback(graph: DependencyGraph, affectedIds: string[]): string[] {
  const patterns: string[] = [];
  const seen = new Set<string>();
  for (const id of affectedIds) {
    for (const pattern of graph.nodes.get(id)?.testPatterns ?? []) {
      if (seen.has(pattern)) continue;
      seen.add(pattern);
      patterns.push(pattern);
    }
  }
  return patterns;
}

function selectByCoverageFallback(
  coverages: CoverageEntry[],
  changedEdges: string[],
  count: number,
): { selected: string[]; coveredEdges: number; totalChangedEdges: number; coverageRatio: number } {
  const targetCount = clampSampleCount(count, coverages.length);
  const remaining = new Set(changedEdges);
  const totalChangedEdges = remaining.size;
  const selected: string[] = [];
  const unused = [...coverages];

  while (unused.length > 0 && selected.length < targetCount && remaining.size > 0) {
    let bestIndex = -1;
    let bestGain = 0;

    for (let index = 0; index < unused.length; index++) {
      const gain = unused[index].edges.filter((edge) => remaining.has(edge)).length;
      if (gain > bestGain) {
        bestIndex = index;
        bestGain = gain;
      }
    }

    if (bestIndex === -1 || bestGain === 0) {
      break;
    }

    const chosen = unused.splice(bestIndex, 1)[0];
    selected.push(chosen.suite);
    for (const edge of chosen.edges) {
      remaining.delete(edge);
    }
  }

  const coveredEdges = totalChangedEdges - remaining.size;
  return {
    selected,
    coveredEdges,
    totalChangedEdges,
    coverageRatio: totalChangedEdges === 0 ? 0 : coveredEdges / totalChangedEdges,
  };
}

function bucketizeRateFallback(rate: number): number {
  if (rate <= 0) return 0;
  if (rate < 1) return 1;
  if (rate < 5) return 5;
  if (rate < 10) return 10;
  if (rate < 25) return 25;
  if (rate < 50) return 50;
  if (rate < 75) return 75;
  return 100;
}

function trainGBDTFallback(
  data: { features: number[]; label: number }[],
): { weights: number[]; bias: number } {
  if (data.length === 0) return { weights: [], bias: 0.5 };
  const width = Math.max(...data.map((row) => row.features.length), 0);
  const positives = data.filter((row) => row.label > 0);
  const negatives = data.filter((row) => row.label <= 0);
  const weights = Array.from({ length: width }, (_, index) => {
    const positiveMean = positives.length === 0
      ? 0
      : positives.reduce((sum, row) => sum + (row.features[index] ?? 0), 0) / positives.length;
    const negativeMean = negatives.length === 0
      ? 0
      : negatives.reduce((sum, row) => sum + (row.features[index] ?? 0), 0) / negatives.length;
    return positiveMean - negativeMean;
  });
  const bias = positives.length / data.length;
  return { weights, bias };
}

function predictGBDTFallback(
  model: { weights?: number[]; bias?: number } | null | undefined,
  features: number[],
): number {
  const weights = model?.weights ?? [];
  const bias = model?.bias ?? 0.5;
  let score = Math.log(Math.max(bias, 1e-6) / Math.max(1 - bias, 1e-6));
  for (let index = 0; index < weights.length; index++) {
    score += weights[index] * (features[index] ?? 0);
  }
  return 1 / (1 + Math.exp(-score));
}

function generateFixtureFallback(config: FixtureConfig): FixtureData {
  const rng = mulberry32(config.seed);
  const fileCount = Math.max(config.tests_per_file, Math.ceil(config.test_count / Math.max(config.tests_per_file, 1)));
  const files = Array.from({ length: fileCount }, (_, index) => `src/module_${index}.ts`);
  const tests = Array.from({ length: config.test_count }, (_, index) => ({
    suite: `test_${index}`,
    test_name: `case_${index}`,
    is_flaky: rng() < config.flaky_rate,
  }));
  const file_deps = files.map((file, index) => ({
    file,
    suites: tests
      .filter((_, testIndex) => testIndex % fileCount === index)
      .slice(0, Math.max(1, config.tests_per_file))
      .map((test) => test.suite),
  }));

  const commits = Array.from({ length: config.commit_count }, (_, index) => {
    const changed_files = Array.from(
      { length: Math.max(1, config.files_per_commit) },
      () => {
        const fileIndex = Math.floor(rng() * files.length);
        return { file_path: files[fileIndex], change_type: "modified" };
      },
    );
    const affectedSuites = new Set(
      changed_files.flatMap((entry) =>
        file_deps.find((dep) => dep.file === entry.file_path)?.suites ?? [],
      ),
    );
    const test_results = tests
      .filter((test) => affectedSuites.has(test.suite))
      .map((test) => ({
        suite: test.suite,
        test_name: test.test_name,
        status: test.is_flaky && rng() < 0.5 ? "failed" : "passed",
      }));
    return {
      sha: `commit_${index}`,
      changed_files,
      test_results,
    };
  });

  return {
    tests,
    files,
    file_deps,
    commits,
    config,
  };
}

export function createTypeScriptFallbackCore(): FlakerCore {
  return {
    detectFlaky: detectFlakyFallback,
    sampleRandom: sampleRandomFallback,
    sampleWeighted: sampleWeightedFallback,
    sampleHybrid: sampleHybridFallback,
    buildSamplingMeta: buildSamplingMetaFallback,
    resolveAffected: resolveAffectedFallback,
    findAffectedNodes: findAffectedNodesFallback,
    expandTransitive: expandTransitiveFallback,
    buildReverseDeps: buildReverseDepsFallback,
    topologicalSort: topologicalSortFallback,
    getAffectedTestPatterns: getAffectedTestPatternsFallback,
    selectByCoverage: selectByCoverageFallback,
    bucketizeRate: bucketizeRateFallback,
    trainGBDT: trainGBDTFallback,
    predictGBDT: predictGBDTFallback,
    generateFixture: generateFixtureFallback,
  };
}
