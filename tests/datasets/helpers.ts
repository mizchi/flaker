// tests/datasets/helpers.ts
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { syncDatasetSettings, type DatasetSettings } from "../../src/cli/datasets/config-sync.js";

export const DAY = 86_400_000;

export async function memoryStore(settings: Partial<DatasetSettings> = {}): Promise<DuckDBStore> {
  const store = new DuckDBStore(":memory:");
  await store.initialize();
  await syncDatasetSettings(store, {
    flakyWindowDays: 14,
    flakyThresholdRatio: 0.02,
    coFailureWindowDays: 90,
    fullRunRatio: 0.95,
    fullByLane: {},
    ...settings,
  });
  return store;
}

export interface SeedResult {
  suite: string;
  testName: string;
  status: string;
  retryCount?: number;
  titlePath?: string[];
  variant?: Record<string, string>;
}

export async function seedRun(store: DuckDBStore, run: {
  id: number;
  commitSha: string;
  daysAgo: number;
  workflowName?: string;
  lane?: string;
  source?: "ci" | "local";
  results: SeedResult[];
}): Promise<void> {
  const createdAt = new Date(Date.now() - run.daysAgo * DAY);
  await store.insertWorkflowRun({
    id: run.id, repo: "o/r", branch: "main", commitSha: run.commitSha, event: "push",
    source: run.source ?? "ci", status: "completed", createdAt, durationMs: 1,
    workflowName: run.workflowName ?? "ci", lane: run.lane ?? null,
  });
  await store.insertTestResults(run.results.map((r) => ({
    workflowRunId: run.id, suite: r.suite, testName: r.testName, status: r.status,
    durationMs: 10, retryCount: r.retryCount ?? 0, errorMessage: null,
    commitSha: run.commitSha, variant: r.variant ?? null, titlePath: r.titlePath ?? null, createdAt,
  })));
}

export async function keyFor(store: DuckDBStore, suite: string, testName: string): Promise<string> {
  const [row] = await store.raw<{ test_key: string }>(
    `SELECT test_key FROM flaker_v1.tests WHERE suite = ? AND test_name = ?`,
    [suite, testName],
  );
  if (!row) throw new Error(`no test ${suite} :: ${testName}`);
  return row.test_key;
}

export interface SeedVerdict {
  testKey: string | null;
  file: string;
  titlePath: string[];
  reason: string;
  selected: boolean;
  score?: number | null;
  confidence?: number | null;
}

/** Writes selector tables directly; 2b replaces this with insertSelectorRecord. */
export async function seedSelectorRun(store: DuckDBStore, run: {
  id: string;
  headSha: string | null;
  source?: "real" | "mutation";
  contextDigest?: string | null;
  tests: SeedVerdict[];
}): Promise<void> {
  await store.raw(
    `INSERT INTO selector_runs (selector_run_id, selector, selector_version, head_sha, base_sha, context_digest, source, gate, created_at)
     VALUES (?, 'jev', NULL, ?, NULL, ?, ?, NULL, ?)`,
    [run.id, run.headSha, run.contextDigest ?? null, run.source ?? "real", new Date()],
  );
  for (const [i, t] of run.tests.entries()) {
    await store.raw(
      `INSERT INTO selector_run_tests (selector_run_id, ordinal, test_key, file, title_path, project, runner_file, score, confidence, reason, selected)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
      [run.id, i, t.testKey, t.file, JSON.stringify(t.titlePath), t.score ?? null, t.confidence ?? null, t.reason, t.selected],
    );
  }
}
