import { access } from "node:fs/promises";
import type { DependencyGraph, GraphNode } from "../graph/types.js";
import { MOONBIT_JS_BRIDGE_URL } from "./build-artifact.js";
import { createStableTestId, resolveTestIdentity } from "../identity.js";
import {
  buildReverseDeps as buildReverseDepsFallback,
  expandTransitive as expandTransitiveFallback,
  findAffectedNodes as findAffectedNodesFallback,
  getAffectedTestPatterns as getAffectedTestPatternsFallback,
  topologicalSort as topologicalSortFallback,
} from "../graph/analyzer.js";

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

export interface MetriciCore {
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

/** LCG PRNG: returns next state and a float in [0, 1) */
function lcg(seed: number): { next: number; value: number } {
  // LCG parameters (Numerical Recipes)
  const next = (seed * 1664525 + 1013904223) >>> 0;
  const value = next / 0x100000000;
  return { next, value };
}

function detectFlaky(input: DetectInput): DetectOutput {
  const groups = new Map<
    string,
    { suite: string; test_name: string; total: number; fails: number; flaky_retries: number }
  >();

  for (const r of input.results) {
    const key = `${r.suite}\0${r.test_name}`;
    let g = groups.get(key);
    if (!g) {
      g = { suite: r.suite, test_name: r.test_name, total: 0, fails: 0, flaky_retries: 0 };
      groups.set(key, g);
    }
    g.total++;
    if (r.status === "failed") {
      g.fails++;
    }
    if (r.retry_count > 0 && r.status === "passed") {
      g.flaky_retries++;
    }
  }

  const flaky_tests: FlakyResult[] = [];
  for (const g of groups.values()) {
    if (g.total < input.min_runs) continue;
    const flaky_rate = ((g.fails + g.flaky_retries) / g.total) * 100;
    if (flaky_rate < input.threshold) continue;
    flaky_tests.push({
      suite: g.suite,
      test_name: g.test_name,
      flaky_rate,
      total_runs: g.total,
      fail_count: g.fails,
      flaky_retry_count: g.flaky_retries,
      is_quarantined: false,
    });
  }

  flaky_tests.sort((a, b) => b.flaky_rate - a.flaky_rate);
  return { flaky_tests };
}

function sampleRandom(meta: TestMeta[], count: number, seed: number): TestMeta[] {
  const actualCount = clampSampleCount(count, meta.length);
  if (actualCount === 0) {
    return [];
  }
  const arr = [...meta];
  let s = seed >>> 0;

  // Fisher-Yates shuffle
  for (let i = arr.length - 1; i > 0; i--) {
    const r = lcg(s);
    s = r.next;
    const j = Math.floor(r.value * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr.slice(0, actualCount);
}

function sampleWeighted(meta: TestMeta[], count: number, seed: number): TestMeta[] {
  const actualCount = clampSampleCount(count, meta.length);
  if (actualCount === 0) {
    return [];
  }
  const remaining = [...meta];
  const result: TestMeta[] = [];
  let s = seed >>> 0;

  const n = actualCount;
  for (let picked = 0; picked < n; picked++) {
    // Compute weights
    const weights = remaining.map((m) => 1.0 + m.flaky_rate + (m.co_failure_boost ?? 0));
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    const r = lcg(s);
    s = r.next;
    const target = r.value * totalWeight;

    let cumulative = 0;
    let idx = 0;
    for (let i = 0; i < weights.length; i++) {
      cumulative += weights[i];
      if (cumulative > target) {
        idx = i;
        break;
      }
    }

    result.push(remaining[idx]);
    remaining.splice(idx, 1);
  }

  return result;
}

function sampleHybrid(meta: TestMeta[], affectedSuites: string[], count: number, seed: number): TestMeta[] {
  const actualCount = clampSampleCount(count, meta.length);
  if (actualCount === 0) {
    return [];
  }
  const affectedSet = new Set(affectedSuites);
  const selected: TestMeta[] = [];
  const used = new Set<number>();

  // Priority 1: affected
  meta.forEach((m, i) => { if (affectedSet.has(m.suite) && !used.has(i)) { selected.push(m); used.add(i); } });
  // Priority 2: previously failed
  meta.forEach((m, i) => { if (m.previously_failed && !used.has(i)) { selected.push(m); used.add(i); } });
  // Priority 3: new
  meta.forEach((m, i) => { if (m.is_new && !used.has(i)) { selected.push(m); used.add(i); } });
  // Priority 4: weighted random for remaining
  if (selected.length < actualCount) {
    const remaining = meta.filter((_, i) => !used.has(i));
    const extra = sampleWeighted(remaining, actualCount - selected.length, seed);
    selected.push(...extra);
  }
  return selected.slice(0, actualCount);
}

function clampSampleCount(count: number, total: number): number {
  if (!Number.isFinite(count)) {
    return 0;
  }
  return Math.max(0, Math.min(Math.trunc(count), total));
}

function fromCoreVariantEntries(
  variant?: StableVariantEntryInput[] | null,
): Record<string, string> | null {
  if (!variant || variant.length === 0) {
    return null;
  }
  return Object.fromEntries(
    [...variant]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((entry) => [entry.key, entry.value] as const),
  );
}

function roundPercent(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return Math.round(((numerator * 100) / denominator) * 100) / 100;
}

function createSuiteTestKey(suite: string, testName: string): string {
  return `${suite}\0${testName}`;
}

function isDefaultHistoryIdentity(row: SamplingHistoryRowInput): boolean {
  return (
    (row.task_id == null || row.task_id === row.suite) &&
    row.filter == null &&
    (row.test_id == null ||
      row.test_id ===
        createStableTestId({
          suite: row.suite,
          testName: row.test_name,
        }))
  );
}

function buildSamplingMetaFallback(
  historyRows: SamplingHistoryRowInput[],
  listedTests: SamplingListedTestInput[],
): TestMeta[] {
  const accById = new Map<
    string,
    {
      suite: string;
      test_name: string;
      task_id: string;
      filter: string | null;
      test_id: string;
      total_runs: number;
      fail_count: number;
      failure_signals: number;
      total_duration_ms: number;
      last_run_at: string;
    }
  >();
  const listedBySuiteTest = new Map<string, SamplingListedTestInput[]>();

  for (const listedTest of listedTests) {
    const key = createSuiteTestKey(listedTest.suite, listedTest.test_name);
    const existing = listedBySuiteTest.get(key);
    if (existing) {
      existing.push(listedTest);
    } else {
      listedBySuiteTest.set(key, [listedTest]);
    }
  }

  for (const row of historyRows) {
    const listedCandidates =
      isDefaultHistoryIdentity(row)
        ? listedBySuiteTest.get(createSuiteTestKey(row.suite, row.test_name)) ?? []
        : [];
    const resolved =
      listedCandidates.length === 1
        ? resolveTestIdentity({
            suite: listedCandidates[0].suite,
            testName: listedCandidates[0].test_name,
            taskId: listedCandidates[0].task_id,
            filter: listedCandidates[0].filter,
            variant: fromCoreVariantEntries(listedCandidates[0].variant),
            testId: listedCandidates[0].test_id ?? undefined,
          })
        : resolveTestIdentity({
            suite: row.suite,
            testName: row.test_name,
            taskId: row.task_id,
            filter: row.filter,
            variant: fromCoreVariantEntries(row.variant),
            testId: row.test_id ?? undefined,
          });
    const acc = accById.get(resolved.testId) ?? {
      suite: resolved.suite,
      test_name: resolved.testName,
      task_id: resolved.taskId,
      filter: resolved.filter,
      test_id: resolved.testId,
      total_runs: 0,
      fail_count: 0,
      failure_signals: 0,
      total_duration_ms: 0,
      last_run_at: "",
    };

    acc.total_runs += 1;
    if (row.status === "failed") {
      acc.fail_count += 1;
    }
    if (
      row.status === "failed" ||
      row.status === "flaky" ||
      (row.retry_count > 0 && row.status === "passed")
    ) {
      acc.failure_signals += 1;
    }
    acc.total_duration_ms += row.duration_ms;
    if (row.created_at > acc.last_run_at) {
      acc.last_run_at = row.created_at;
    }

    accById.set(resolved.testId, acc);
  }

  for (const test of listedTests) {
    const resolved = resolveTestIdentity({
      suite: test.suite,
      testName: test.test_name,
      taskId: test.task_id,
      filter: test.filter,
      variant: fromCoreVariantEntries(test.variant),
      testId: test.test_id ?? undefined,
    });
    if (accById.has(resolved.testId)) {
      continue;
    }
    accById.set(resolved.testId, {
      suite: resolved.suite,
      test_name: resolved.testName,
      task_id: resolved.taskId,
      filter: resolved.filter,
      test_id: resolved.testId,
      total_runs: 0,
      fail_count: 0,
      failure_signals: 0,
      total_duration_ms: 0,
      last_run_at: "",
    });
  }

  return [...accById.values()]
    .map((entry) => ({
      suite: entry.suite,
      test_name: entry.test_name,
      flaky_rate: roundPercent(entry.failure_signals, entry.total_runs),
      total_runs: entry.total_runs,
      fail_count: entry.fail_count,
      last_run_at: entry.last_run_at,
      avg_duration_ms:
        entry.total_runs > 0
          ? Math.round(entry.total_duration_ms / entry.total_runs)
          : 0,
      previously_failed: entry.failure_signals > 0,
      is_new: entry.total_runs <= 1,
      task_id: entry.task_id,
      filter: entry.filter,
      test_id: entry.test_id,
      co_failure_boost: 0,
    }))
    .sort(
      (a, b) =>
        (a.test_id ?? "").localeCompare(b.test_id ?? "") ||
        a.suite.localeCompare(b.suite) ||
        a.test_name.localeCompare(b.test_name),
    );
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

function wrapMbtCore(mbt: MbtJsExports): MetriciCore {
  return {
    detectFlaky(input: DetectInput): DetectOutput {
      return JSON.parse(mbt.detect_flaky_json(JSON.stringify(input)));
    },
    sampleRandom(meta: TestMeta[], count: number, seed: number): TestMeta[] {
      return JSON.parse(mbt.sample_random_json(JSON.stringify(meta), count, seed));
    },
    sampleWeighted(meta: TestMeta[], count: number, seed: number): TestMeta[] {
      return JSON.parse(mbt.sample_weighted_json(JSON.stringify(meta), count, seed));
    },
    sampleHybrid(meta: TestMeta[], affectedSuites: string[], count: number, seed: number): TestMeta[] {
      return JSON.parse(mbt.sample_hybrid_json(JSON.stringify(meta), JSON.stringify(affectedSuites), count, seed));
    },
    buildSamplingMeta(
      historyRows: SamplingHistoryRowInput[],
      listedTests: SamplingListedTestInput[],
    ): TestMeta[] {
      return JSON.parse(
        mbt.build_sampling_meta_json(
          JSON.stringify(historyRows.map(normalizeSamplingHistoryRow)),
          JSON.stringify(listedTests.map(normalizeSamplingListedTest)),
        ),
      );
    },
    resolveAffected(workflowText: string, changedPaths: string[]): string[] {
      return JSON.parse(mbt.resolve_affected_json(workflowText, JSON.stringify(changedPaths)));
    },
    findAffectedNodes(graph: DependencyGraph, changedFiles: string[]): string[] {
      return JSON.parse(mbt.find_affected_nodes_json(serializeGraph(graph), JSON.stringify(changedFiles)));
    },
    expandTransitive(graph: DependencyGraph, initial: Set<string>): string[] {
      return JSON.parse(mbt.expand_transitive_json(serializeGraph(graph), JSON.stringify([...initial])));
    },
    buildReverseDeps(graph: DependencyGraph): Map<string, string[]> {
      const entries = JSON.parse(mbt.build_reverse_deps_json(serializeGraph(graph))) as ReverseDepEntry[];
      return deserializeReverseDeps(entries);
    },
    topologicalSort(graph: DependencyGraph): string[] {
      return JSON.parse(mbt.topological_sort_json(serializeGraph(graph)));
    },
    getAffectedTestPatterns(graph: DependencyGraph, affectedIds: string[]): string[] {
      return JSON.parse(mbt.get_affected_test_patterns_json(serializeGraph(graph), JSON.stringify(affectedIds)));
    },
  };
}

let cachedCore: MetriciCore | undefined;

export async function loadCore(): Promise<MetriciCore> {
  if (cachedCore) return cachedCore;
  try {
    const mbtPath = MOONBIT_JS_BRIDGE_URL.href;
    const mbt = (await import(mbtPath)) as MbtJsExports;
    if (
      typeof mbt.detect_flaky_json === "function" &&
      typeof mbt.sample_random_json === "function" &&
      typeof mbt.sample_weighted_json === "function" &&
      typeof mbt.sample_hybrid_json === "function" &&
      typeof mbt.build_sampling_meta_json === "function" &&
      typeof mbt.resolve_affected_json === "function" &&
      typeof mbt.find_affected_nodes_json === "function" &&
      typeof mbt.expand_transitive_json === "function" &&
      typeof mbt.build_reverse_deps_json === "function" &&
      typeof mbt.topological_sort_json === "function" &&
      typeof mbt.get_affected_test_patterns_json === "function"
    ) {
      cachedCore = wrapMbtCore(mbt);
      return cachedCore;
    }
  } catch {
    // MoonBit JS build not available, fall back to TS implementation
  }
  cachedCore = {
    detectFlaky,
    sampleRandom,
    sampleWeighted,
    sampleHybrid,
    buildSamplingMeta: buildSamplingMetaFallback,
    resolveAffected: resolveAffectedFallback,
    findAffectedNodes: findAffectedNodesFallback,
    expandTransitive: expandTransitiveFallback,
    buildReverseDeps: buildReverseDepsFallback,
    topologicalSort: topologicalSortFallback,
    getAffectedTestPatterns: getAffectedTestPatternsFallback,
  };
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

/** Synchronous fallback for contexts where async is not possible */
export function loadCoreSync(): MetriciCore {
  return {
    detectFlaky,
    sampleRandom,
    sampleWeighted,
    sampleHybrid,
    buildSamplingMeta: buildSamplingMetaFallback,
    resolveAffected: resolveAffectedFallback,
    findAffectedNodes: findAffectedNodesFallback,
    expandTransitive: expandTransitiveFallback,
    buildReverseDeps: buildReverseDepsFallback,
    topologicalSort: topologicalSortFallback,
    getAffectedTestPatterns: getAffectedTestPatternsFallback,
  };
}

interface FallbackTask {
  id: string;
  needs: string[];
  srcs: string[];
}

/** TS fallback for affected-target resolution when MoonBit build is unavailable. */
function resolveAffectedFallback(workflowText: string, changedPaths: string[]): string[] {
  const tasks = parseWorkflowTasks(workflowText);
  if (tasks.length === 0 || changedPaths.length === 0) return [];

  const initial = new Set<string>();
  for (const task of tasks) {
    if (task.srcs.length === 0) continue;
    const matched = changedPaths.some((path) => task.srcs.some((pattern) => matchGlob(pattern, path)));
    if (matched) {
      initial.add(task.id);
    }
  }
  if (initial.size === 0) return [];

  const byNeed = new Map<string, string[]>();
  for (const task of tasks) {
    for (const need of task.needs) {
      const dependents = byNeed.get(need);
      if (dependents) dependents.push(task.id);
      else byNeed.set(need, [task.id]);
    }
  }

  // Expand transitive dependents (A needed by B => A change affects B)
  const affected = new Set(initial);
  const queue = [...initial];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    for (const dependent of byNeed.get(current) ?? []) {
      if (!affected.has(dependent)) {
        affected.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return [...affected];
}

function parseWorkflowTasks(workflowText: string): FallbackTask[] {
  const blocks = extractTaskBlocks(workflowText);
  const tasks: FallbackTask[] = [];
  for (const block of blocks) {
    const id = getQuotedValue(block, "id");
    if (!id) continue;

    tasks.push({
      id,
      needs: getQuotedArrayValue(block, "needs"),
      srcs: getQuotedArrayValue(block, "srcs"),
    });
  }
  return tasks;
}

function extractTaskBlocks(workflowText: string): string[] {
  const blocks: string[] = [];
  let i = 0;
  while (i < workflowText.length) {
    const idx = workflowText.indexOf("task(", i);
    if (idx === -1) break;

    let depth = 0;
    let inString = false;
    let end = idx;
    for (; end < workflowText.length; end++) {
      const ch = workflowText[end];
      const prev = end > 0 ? workflowText[end - 1] : "";

      if (ch === "\"" && prev !== "\\") {
        inString = !inString;
      }
      if (inString) continue;

      if (ch === "(") depth++;
      if (ch === ")") {
        depth--;
        if (depth === 0) {
          end++;
          break;
        }
      }
    }
    if (end > idx) {
      blocks.push(workflowText.slice(idx, end));
      i = end;
    } else {
      i = idx + 5;
    }
  }
  return blocks;
}

function getQuotedValue(line: string, key: string): string | null {
  const m = new RegExp(`${key}\\s*=\\s*(['"])(.*?)\\1`, "s").exec(line);
  return m?.[2] ?? null;
}

function getQuotedArrayValue(line: string, key: string): string[] {
  const m = new RegExp(`${key}\\s*=\\s*\\[(.*?)\\]`, "s").exec(line);
  if (!m) return [];
  const inner = m[1].trim();
  if (!inner) return [];
  const values: string[] = [];
  const re = /(['"])(.*?)\1/g;
  for (const match of inner.matchAll(re)) {
    values.push(match[2]);
  }
  return values;
}

function matchGlob(pattern: string, target: string): boolean {
  const normalizedPattern = pattern.replaceAll("\\", "/");
  const normalizedTarget = target.replaceAll("\\", "/");
  const regex = globToRegex(normalizedPattern);
  return regex.test(normalizedTarget);
}

function globToRegex(pattern: string): RegExp {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      const next = pattern[i + 1];
      if (next === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (".+?^${}()|[]\\".includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  out += "$";
  return new RegExp(out);
}
