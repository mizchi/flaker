import { access } from "node:fs/promises";
import type { DependencyGraph } from "../graph/types.js";
import { MOONBIT_JS_BRIDGE_URL } from "./build-artifact.js";
import { importOptionalMoonBitBridge } from "./bridge-loader.js";
import { createTypeScriptFallbackCore } from "./fallback.js";

export interface DetectInput {
  results: Array<{
    suite: string;
    test_name: string;
    status: string;
    retry_count: number;
  }>;
  threshold: number;
  min_runs: number;
}

export interface FlakyResult {
  suite: string;
  test_name: string;
  flaky_rate: number;
  total_runs: number;
  fail_count: number;
  flaky_retry_count: number;
  is_quarantined: boolean;
}

export interface DetectOutput {
  flaky_tests: FlakyResult[];
}

export interface TestMeta {
  suite: string;
  test_name: string;
  flaky_rate: number;
  total_runs: number;
  fail_count: number;
  last_run_at: string;
  avg_duration_ms: number;
  previously_failed: boolean;
  is_new: boolean;
  task_id?: string | null;
  filter?: string | null;
  test_id?: string | null;
  co_failure_boost: number;
}

export interface StableVariantEntryInput {
  key: string;
  value: string;
}

export interface SamplingHistoryRowInput {
  suite: string;
  test_name: string;
  task_id?: string | null;
  filter?: string | null;
  variant?: StableVariantEntryInput[] | null;
  test_id?: string | null;
  status: string;
  retry_count: number;
  duration_ms: number;
  created_at: string;
}

export interface SamplingListedTestInput {
  suite: string;
  test_name: string;
  task_id?: string | null;
  filter?: string | null;
  variant?: StableVariantEntryInput[] | null;
  test_id?: string | null;
}

export interface FlakerCore {
  detectFlaky(input: DetectInput): DetectOutput;
  sampleRandom(meta: TestMeta[], count: number, seed: number): TestMeta[];
  sampleWeighted(meta: TestMeta[], count: number, seed: number): TestMeta[];
  sampleHybrid(meta: TestMeta[], affectedSuites: string[], count: number, seed: number): TestMeta[];
  buildSamplingMeta(
    historyRows: SamplingHistoryRowInput[],
    listedTests: SamplingListedTestInput[],
  ): TestMeta[];
  resolveAffected(workflowText: string, changedPaths: string[]): string[];
  findAffectedNodes(graph: DependencyGraph, changedFiles: string[]): string[];
  expandTransitive(graph: DependencyGraph, initial: Set<string>): string[];
  buildReverseDeps(graph: DependencyGraph): Map<string, string[]>;
  topologicalSort(graph: DependencyGraph): string[];
  getAffectedTestPatterns(graph: DependencyGraph, affectedIds: string[]): string[];
  selectByCoverage(coverages: { suite: string; test_name: string; edges: string[] }[], changedEdges: string[], count: number): { selected: string[]; coveredEdges: number; totalChangedEdges: number; coverageRatio: number };
  bucketizeRate(rate: number): number;
  trainGBDT(data: { features: number[]; label: number }[], numTrees: number, learningRate: number): unknown;
  predictGBDT(model: unknown, features: number[]): number;
  generateFixture(config: FixtureConfig): FixtureData;
}

export interface FixtureConfig {
  test_count: number;
  commit_count: number;
  flaky_rate: number;
  co_failure_strength: number;
  files_per_commit: number;
  tests_per_file: number;
  sample_percentage: number;
  seed: number;
}

export interface FixtureData {
  tests: { suite: string; test_name: string; is_flaky: boolean }[];
  files: string[];
  file_deps: { file: string; suites: string[] }[];
  commits: {
    sha: string;
    changed_files: { file_path: string; change_type: string }[];
    test_results: { suite: string; test_name: string; status: string }[];
  }[];
  config: FixtureConfig;
}

interface SerializableGraphNode {
  id: string;
  path: string;
  dependencies: string[];
  source_patterns: string[];
  test_patterns: string[];
}

interface SerializableDependencyGraph {
  root_dir: string;
  nodes: SerializableGraphNode[];
}

interface ReverseDepEntry {
  id: string;
  dependents: string[];
}

function normalizeSamplingHistoryRow(
  row: SamplingHistoryRowInput,
): SamplingHistoryRowInput {
  return {
    suite: row.suite,
    test_name: row.test_name,
    status: row.status,
    retry_count: row.retry_count,
    duration_ms: row.duration_ms,
    created_at: row.created_at,
    ...(row.task_id != null ? { task_id: row.task_id } : {}),
    ...(row.filter != null ? { filter: row.filter } : {}),
    ...(row.variant != null ? { variant: row.variant } : {}),
    ...(row.test_id != null ? { test_id: row.test_id } : {}),
  };
}

function normalizeSamplingListedTest(
  test: SamplingListedTestInput,
): SamplingListedTestInput {
  return {
    suite: test.suite,
    test_name: test.test_name,
    ...(test.task_id != null ? { task_id: test.task_id } : {}),
    ...(test.filter != null ? { filter: test.filter } : {}),
    ...(test.variant != null ? { variant: test.variant } : {}),
    ...(test.test_id != null ? { test_id: test.test_id } : {}),
  };
}

// MoonBit JS backend types
interface MbtJsExports {
  detect_flaky_json: (input: string) => string;
  sample_random_json: (meta: string, count: number, seed: number) => string;
  sample_weighted_json: (meta: string, count: number, seed: number) => string;
  sample_hybrid_json: (meta: string, affected: string, count: number, seed: number) => string;
  build_sampling_meta_json: (historyRows: string, listedTests: string) => string;
  resolve_affected_json: (workflow: string, changed: string) => string;
  find_affected_nodes_json: (graph: string, changed: string) => string;
  expand_transitive_json: (graph: string, initial: string) => string;
  build_reverse_deps_json: (graph: string) => string;
  topological_sort_json: (graph: string) => string;
  get_affected_test_patterns_json: (graph: string, affectedIds: string) => string;
  select_by_coverage_json: (coverages: string, changedEdges: string, count: number) => string;
  bucketize_rate_json: (rate: number) => number;
  train_gbdt_json: (data: string, numTrees: number, learningRate: number) => string;
  predict_gbdt_json: (model: string, features: string) => number;
  predict_batch_gbdt_json: (model: string, batch: string) => string;
  generate_fixture_json: (config: string) => string;
}

function isMbtJsExports(mod: Partial<MbtJsExports>): mod is MbtJsExports {
  return (
    typeof mod.detect_flaky_json === "function"
    && typeof mod.sample_random_json === "function"
    && typeof mod.sample_weighted_json === "function"
    && typeof mod.sample_hybrid_json === "function"
    && typeof mod.build_sampling_meta_json === "function"
    && typeof mod.resolve_affected_json === "function"
    && typeof mod.find_affected_nodes_json === "function"
    && typeof mod.expand_transitive_json === "function"
    && typeof mod.build_reverse_deps_json === "function"
    && typeof mod.topological_sort_json === "function"
    && typeof mod.get_affected_test_patterns_json === "function"
    && typeof mod.select_by_coverage_json === "function"
    && typeof mod.bucketize_rate_json === "function"
    && typeof mod.train_gbdt_json === "function"
    && typeof mod.predict_gbdt_json === "function"
    && typeof mod.generate_fixture_json === "function"
  );
}

function serializeGraph(graph: DependencyGraph): string {
  const serializable: SerializableDependencyGraph = {
    root_dir: graph.rootDir,
    nodes: [...graph.nodes.values()].map((node): SerializableGraphNode => ({
      id: node.id,
      path: node.path,
      dependencies: [...node.dependencies],
      source_patterns: [...node.sourcePatterns],
      test_patterns: [...node.testPatterns],
    })),
  };
  return JSON.stringify(serializable);
}

function deserializeReverseDeps(entries: ReverseDepEntry[]): Map<string, string[]> {
  const reverse = new Map<string, string[]>();
  for (const entry of entries) {
    reverse.set(entry.id, [...entry.dependents]);
  }
  return reverse;
}

/** Restore co_failure_boost from input meta after MoonBit round-trip (MoonBit Option<Double> may serialize differently) */
function normalizeMetaBoosts(result: TestMeta[], inputMeta: TestMeta[]): TestMeta[] {
  const boostByKey = new Map<string, number>();
  for (const m of inputMeta) {
    const key = m.test_id ?? `${m.suite}\0${m.test_name}`;
    if (m.co_failure_boost && m.co_failure_boost > 0) {
      boostByKey.set(key, m.co_failure_boost);
    }
  }
  if (boostByKey.size === 0) return result;
  return result.map((m) => {
    const key = m.test_id ?? `${m.suite}\0${m.test_name}`;
    const boost = boostByKey.get(key);
    return boost != null ? { ...m, co_failure_boost: boost } : { ...m, co_failure_boost: m.co_failure_boost ?? 0 };
  });
}

function wrapMbtCore(mbt: MbtJsExports): FlakerCore {
  return {
    detectFlaky(input: DetectInput): DetectOutput {
      return JSON.parse(mbt.detect_flaky_json(JSON.stringify(input)));
    },
    sampleRandom(meta, count, seed) {
      return normalizeMetaBoosts(
        JSON.parse(mbt.sample_random_json(JSON.stringify(meta), count, seed)),
        meta,
      );
    },
    sampleWeighted(meta, count, seed) {
      return normalizeMetaBoosts(
        JSON.parse(mbt.sample_weighted_json(JSON.stringify(meta), count, seed)),
        meta,
      );
    },
    sampleHybrid(meta, affectedSuites, count, seed) {
      return normalizeMetaBoosts(
        JSON.parse(mbt.sample_hybrid_json(JSON.stringify(meta), JSON.stringify(affectedSuites), count, seed)),
        meta,
      );
    },
    buildSamplingMeta(historyRows, listedTests) {
      return JSON.parse(
        mbt.build_sampling_meta_json(
          JSON.stringify(historyRows.map(normalizeSamplingHistoryRow)),
          JSON.stringify(listedTests.map(normalizeSamplingListedTest)),
        ),
      );
    },
    resolveAffected(workflowText, changedPaths) {
      return JSON.parse(mbt.resolve_affected_json(workflowText, JSON.stringify(changedPaths)));
    },
    findAffectedNodes(graph, changedFiles) {
      return JSON.parse(mbt.find_affected_nodes_json(serializeGraph(graph), JSON.stringify(changedFiles)));
    },
    expandTransitive(graph, initial) {
      return JSON.parse(mbt.expand_transitive_json(serializeGraph(graph), JSON.stringify([...initial])));
    },
    buildReverseDeps(graph) {
      const entries = JSON.parse(mbt.build_reverse_deps_json(serializeGraph(graph))) as ReverseDepEntry[];
      return deserializeReverseDeps(entries);
    },
    topologicalSort(graph) {
      return JSON.parse(mbt.topological_sort_json(serializeGraph(graph)));
    },
    getAffectedTestPatterns(graph, affectedIds) {
      return JSON.parse(mbt.get_affected_test_patterns_json(serializeGraph(graph), JSON.stringify(affectedIds)));
    },
    selectByCoverage(coverages, changedEdges, count) {
      const raw = JSON.parse(mbt.select_by_coverage_json(JSON.stringify(coverages), JSON.stringify(changedEdges), count));
      return { selected: raw.selected, coveredEdges: raw.covered_edges, totalChangedEdges: raw.total_changed_edges, coverageRatio: raw.coverage_ratio };
    },
    bucketizeRate(rate) {
      return mbt.bucketize_rate_json(rate);
    },
    trainGBDT(data, numTrees, learningRate) {
      return JSON.parse(mbt.train_gbdt_json(JSON.stringify(data), numTrees, learningRate));
    },
    predictGBDT(model: unknown, features: number[]) {
      return mbt.predict_gbdt_json(JSON.stringify(model), JSON.stringify(features));
    },
    generateFixture(config) {
      return JSON.parse(mbt.generate_fixture_json(JSON.stringify(config)));
    },
  };
}

let cachedCore: FlakerCore | undefined;

export async function loadCore(): Promise<FlakerCore> {
  if (cachedCore) return cachedCore;
  const mbt = await importOptionalMoonBitBridge<MbtJsExports>(
    MOONBIT_JS_BRIDGE_URL,
    isMbtJsExports,
  );
  cachedCore = mbt
    ? wrapMbtCore(mbt)
    : createTypeScriptFallbackCore();
  return cachedCore;
}

export async function hasMoonBitJsBuild(): Promise<boolean> {
  try {
    await access(MOONBIT_JS_BRIDGE_URL);
    return true;
  } catch {
    return false;
  }
}
