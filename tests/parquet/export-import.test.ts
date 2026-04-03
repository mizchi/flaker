import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";

describe("Parquet export and import", () => {
  let store: DuckDBStore;
  let tmpDir: string;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
    tmpDir = join(tmpdir(), `flaker-parquet-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    // Seed data
    await store.insertWorkflowRun({
      id: 1, repo: "test/repo", branch: "main", commitSha: "sha1",
      event: "push", status: "completed",
      createdAt: new Date("2026-04-01"), durationMs: 60000,
    });
    await store.insertCommitChanges("sha1", [
      { filePath: "src/foo.ts", changeType: "modified", additions: 10, deletions: 5 },
      { filePath: "src/bar.ts", changeType: "added", additions: 20, deletions: 0 },
    ]);
    await store.insertTestResults([
      {
        workflowRunId: 1, suite: "tests/login.spec.ts", testName: "login works",
        status: "passed", durationMs: 150, retryCount: 0, errorMessage: null,
        commitSha: "sha1", variant: null, createdAt: new Date("2026-04-01"),
      },
      {
        workflowRunId: 1, suite: "tests/signup.spec.ts", testName: "signup works",
        status: "failed", durationMs: 200, retryCount: 1, errorMessage: "timeout",
        commitSha: "sha1", variant: null, createdAt: new Date("2026-04-01"),
      },
    ]);
  });

  afterEach(async () => {
    await store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exports a workflow run to Parquet files", async () => {
    const result = await store.exportRunToParquet(1, tmpDir);

    expect(result.testResultsCount).toBe(2);
    expect(result.commitChangesCount).toBe(2);
    expect(existsSync(result.workflowRunPath)).toBe(true);
    expect(existsSync(result.testResultsPath)).toBe(true);
    expect(existsSync(result.commitChangesPath)).toBe(true);
  });

  it("round-trips data through Parquet export/import", async () => {
    // Export
    await store.exportRunToParquet(1, tmpDir);

    // Create a fresh store and import
    const store2 = new DuckDBStore(":memory:");
    await store2.initialize();

    const importResult = await store2.importFromParquetDir(tmpDir);
    expect(importResult.workflowRunsImported).toBe(1);
    expect(importResult.testResultsImported).toBe(2);
    expect(importResult.commitChangesImported).toBe(2);

    // Verify data integrity
    const runs = await store2.raw<{ cnt: number }>(
      "SELECT COUNT(*)::INTEGER AS cnt FROM workflow_runs",
    );
    expect(runs[0].cnt).toBe(1);

    const tests = await store2.raw<{ suite: string; status: string }>(
      "SELECT suite, status FROM test_results ORDER BY suite",
    );
    expect(tests).toHaveLength(2);
    expect(tests[0].suite).toBe("tests/login.spec.ts");
    expect(tests[0].status).toBe("passed");
    expect(tests[1].status).toBe("failed");

    const changes = await store2.raw<{ file_path: string }>(
      "SELECT file_path FROM commit_changes ORDER BY file_path",
    );
    expect(changes).toHaveLength(2);
    expect(changes[0].file_path).toBe("src/bar.ts");

    await store2.close();
  });

  it("import skips duplicate workflow runs", async () => {
    await store.exportRunToParquet(1, tmpDir);
    // Import into same store (already has the data)
    const result = await store.importFromParquetDir(tmpDir);
    // Should not duplicate - ON CONFLICT DO NOTHING
    const runs = await store.raw<{ cnt: number }>(
      "SELECT COUNT(*)::INTEGER AS cnt FROM workflow_runs",
    );
    expect(runs[0].cnt).toBe(1);
  });
});
