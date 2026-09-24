// src/cli/selector/store.ts
import type { MetricStore } from "../storage/types.js";
import type { SelectorRecordV1 } from "../contracts/selector-record-v1.js";
import { selectorRunId } from "../contracts/selector-record-v1.js";
import { readDataset } from "../datasets/read.js";
import { buildTestIndex, matchTestKey, type KnownTest } from "../datasets/test-match.js";

export async function insertSelectorRecord(
  store: MetricStore,
  record: SelectorRecordV1,
): Promise<{ selectorRunId: string; inserted: boolean }> {
  const id = selectorRunId(record);
  const existing = await store.raw(`SELECT 1 FROM selector_runs WHERE selector_run_id = ?`, [id]);
  if (existing.length > 0) return { selectorRunId: id, inserted: false };
  // One transaction: a record is stored whole or not at all. The duplicate check reads only
  // selector_runs, so a truncated record would otherwise be reported as a duplicate forever.
  await store.raw(`BEGIN TRANSACTION`);
  try {
    await store.raw(
      `INSERT INTO selector_runs (selector_run_id, selector, selector_version, head_sha, base_sha, context_digest, source, gate, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, record.selector, record.selector_version, record.head_sha, record.base_sha,
        record.context_digest, record.source, record.gate ? JSON.stringify(record.gate) : null,
        new Date(record.created_at),
      ],
    );
    for (const [ordinal, t] of record.tests.entries()) {
      await store.raw(
        `INSERT INTO selector_run_tests (selector_run_id, ordinal, test_key, file, title_path, project, runner_file, score, confidence, reason, selected)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, ordinal, t.file, JSON.stringify(t.title_path), t.project ?? null, t.runner_file ?? null,
          t.score, t.confidence, t.reason, t.selected,
        ],
      );
    }
    await store.raw(`COMMIT`);
  } catch (error) {
    await store.raw(`ROLLBACK`);
    // A concurrent import committed the same record between the check and the insert.
    if (isPrimaryKeyViolation(error)) return { selectorRunId: id, inserted: false };
    throw error;
  }
  return { selectorRunId: id, inserted: true };
}

function isPrimaryKeyViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate key/i.test(message) && /primary key/i.test(message);
}

/** Fill `test_key` for verdicts not matched yet. Idempotent. */
export async function resolveSelectorTestKeys(
  store: MetricStore,
): Promise<{ resolved: number; unresolved: number }> {
  const pending = await store.raw<{
    selector_run_id: string; ordinal: number; file: string; title_path: string;
    project: string | null; runner_file: string | null;
  }>(
    `SELECT selector_run_id, ordinal, file, title_path, project, runner_file
     FROM selector_run_tests WHERE test_key IS NULL`,
  );
  if (pending.length === 0) return { resolved: 0, unresolved: 0 };
  const known = (await readDataset(store, "tests")).map((row): KnownTest => ({
    test_key: row.test_key as string,
    file: row.file as string,
    title_path: row.title_path as string[],
    test_name: row.test_name as string,
    task_id: row.task_id as string,
    project: ((row.variant as Record<string, string> | null)?.project) ?? null,
  }));
  const index = buildTestIndex(known);
  let resolved = 0;
  for (const p of pending) {
    const key = matchTestKey(index, {
      file: p.file, title_path: JSON.parse(p.title_path), project: p.project, runner_file: p.runner_file,
    });
    if (key === null) continue;
    await store.raw(
      `UPDATE selector_run_tests SET test_key = ? WHERE selector_run_id = ? AND ordinal = ?`,
      [key, p.selector_run_id, p.ordinal],
    );
    resolved++;
  }
  return { resolved, unresolved: pending.length - resolved };
}
