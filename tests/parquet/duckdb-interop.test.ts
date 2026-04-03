import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";

describe("mizchi/parquet → DuckDB read_parquet interop", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("DuckDB reads test_results.parquet", async () => {
    const result = await store.raw<{
      suite: string;
      test_name: string;
      status: string;
      duration_ms: number;
      commit_sha: string;
      retry_count: number;
    }>(`SELECT suite, test_name, status, duration_ms::INTEGER as duration_ms, commit_sha, retry_count::INTEGER as retry_count FROM read_parquet('/tmp/flaker-test-results.parquet') ORDER BY suite`);

    expect(result).toHaveLength(2);
    expect(result[0].suite).toBe("tests/login.spec.ts");
    expect(result[0].test_name).toBe("login works");
    expect(result[0].status).toBe("passed");
    expect(result[0].duration_ms).toBe(150);
    expect(result[1].suite).toBe("tests/signup.spec.ts");
    expect(result[1].status).toBe("failed");
    expect(result[1].retry_count).toBe(1);
  });

  it("DuckDB reads commit_changes.parquet", async () => {
    const result = await store.raw<{
      commit_sha: string;
      file_path: string;
      change_type: string;
      additions: number;
    }>(`SELECT commit_sha, file_path, change_type, additions::INTEGER as additions FROM read_parquet('/tmp/flaker-commit-changes.parquet') ORDER BY file_path`);

    expect(result).toHaveLength(2);
    expect(result[0].file_path).toBe("src/bar.ts");
    expect(result[0].change_type).toBe("added");
    expect(result[0].additions).toBe(20);
    expect(result[1].file_path).toBe("src/foo.ts");
    expect(result[1].additions).toBe(10);
  });

  it("DuckDB reads workflow_runs.parquet", async () => {
    const result = await store.raw<{
      id: number;
      repo: string;
      branch: string;
      commit_sha: string;
      event: string;
      status: string;
    }>(`SELECT id::INTEGER as id, repo, branch, commit_sha, event, status FROM read_parquet('/tmp/flaker-workflow-runs.parquet')`);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(42);
    expect(result[0].repo).toBe("test/repo");
    expect(result[0].branch).toBe("main");
    expect(result[0].event).toBe("push");
  });

  it("DuckDB can query across parquet files with JOIN", async () => {
    const result = await store.raw<{
      file_path: string;
      suite: string;
      status: string;
    }>(`
      SELECT cc.file_path, tr.suite, tr.status
      FROM read_parquet('/tmp/flaker-commit-changes.parquet') cc
      JOIN read_parquet('/tmp/flaker-test-results.parquet') tr
        ON cc.commit_sha = tr.commit_sha
      ORDER BY cc.file_path, tr.suite
    `);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("file_path");
    expect(result[0]).toHaveProperty("suite");
  });
});
