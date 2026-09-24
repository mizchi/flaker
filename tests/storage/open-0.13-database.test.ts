import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";

const OLD_DDL = readFileSync(
  resolve(fileURLToPath(import.meta.url), "../../fixtures/storage/schema-0.13.0.sql"),
  "utf8",
);

/** A database file as flaker 0.13.0 left it: its DDL and a run with one result. */
async function write013Database(path: string): Promise<void> {
  const instance = await DuckDBInstance.create(path);
  const conn = await instance.connect();
  await conn.run(`${OLD_DDL}
      INSERT INTO workflow_runs (id, repo, branch, commit_sha, event, status, created_at, duration_ms, workflow_name)
        VALUES (1, 'o/r', 'main', 'a', 'push', 'completed', TIMESTAMP '2026-09-20 00:00:00', 1, 'ci');
      INSERT INTO test_results (id, workflow_run_id, test_id, task_id, suite, test_name, status, duration_ms, retry_count, commit_sha, created_at)
        VALUES (nextval('test_results_id_seq'), 1, 'k1', 'tests/a.test.ts', 'tests/a.test.ts', 'A works', 'passed', 1, 0, 'a', TIMESTAMP '2026-09-20 00:00:00');
  `);
  conn.closeSync();
  instance.closeSync();
}

describe("a flaker 0.13.0 database", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("opens, gains the new tables, and reads through flaker_v1", async () => {
    dir = mkdtempSync(join(tmpdir(), "flaker-013-"));
    const path = join(dir, "data.duckdb");
    await write013Database(path);

    for (let i = 0; i < 2; i++) {
      // Twice: the second open must also be a no-op migration.
      const store = new DuckDBStore(path);
      await store.initialize();
      const tests = await store.raw<{ test_key: string; file: string; title_path: string }>(
        `SELECT test_key, file, title_path FROM flaker_v1.tests`,
      );
      expect(tests.map((t) => [t.test_key, t.file, JSON.parse(t.title_path)])).toEqual([
        ["k1", "tests/a.test.ts", ["A works"]],
      ]);
      const runs = await store.raw<{ run_id: bigint; source: string; is_full: boolean }>(
        `SELECT run_id, source, is_full FROM flaker_v1.runs`,
      );
      expect(runs.map((r) => [Number(r.run_id), r.source, r.is_full])).toEqual([[1, "ci", true]]);
      const [cfg] = await store.raw<{ n: number }>(`SELECT COUNT(*)::INTEGER AS n FROM flaker_dataset_config`);
      expect(cfg.n).toBe(1);
      await store.close();
    }
  });
});
