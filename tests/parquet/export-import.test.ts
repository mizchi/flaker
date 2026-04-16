import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { recordSamplingRunFromSummary } from "../../src/cli/commands/sampling-run.js";

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
    await store.recordCollectedArtifact({
      workflowRunId: 1,
      adapterType: "playwright",
      artifactName: "playwright-report",
      adapterConfig: "",
      artifactId: 101,
      localArchivePath: "/tmp/flaker/artifacts/collected/1/playwright-playwright-report.zip",
      artifactEntries: ["report.json", "trace-blob.bin"],
    });
    await store.insertTestResults([
      {
        workflowRunId: 1, suite: "tests/login.spec.ts", testName: "login works",
        status: "passed", durationMs: 150, retryCount: 0, errorMessage: null,
        commitSha: "sha1", variant: null, createdAt: new Date("2026-04-01"),
      },
      {
        workflowRunId: 1, suite: "tests/signup.spec.ts", testName: "signup works",
        status: "failed", durationMs: 200, retryCount: 1, errorMessage: "timeout",
        stdout: "signup stdout",
        stderr: "signup stderr",
        artifactPaths: ["/tmp/flaker/signup.stdout.log", "/tmp/flaker/signup.stderr.log"],
        commitSha: "sha1", variant: null, createdAt: new Date("2026-04-01"),
      },
    ]);
    await recordSamplingRunFromSummary(store, {
      id: 1,
      commitSha: "sha1",
      commandKind: "run",
      summary: {
        strategy: "hybrid",
        requestedCount: 2,
        requestedPercentage: null,
        seed: 7,
        changedFiles: ["src/foo.ts"],
        candidateCount: 4,
        selectedCount: 2,
        sampleRatio: 50,
        estimatedSavedTests: 2,
        estimatedSavedMinutes: 1.1,
        fallbackReason: null,
      },
      tests: [
        {
          suite: "tests/login.spec.ts",
          testName: "login works",
          testId: "tests/login.spec.ts::login works",
        },
        {
          suite: "tests/signup.spec.ts",
          testName: "signup works",
          testId: "tests/signup.spec.ts::signup works",
        },
      ],
    });
  });

  afterEach(async () => {
    await store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exports a workflow run to Parquet files", async () => {
    const result = await store.exportRunToParquet(1, tmpDir);

    expect(result.testResultsCount).toBe(2);
    expect(result.commitChangesCount).toBe(2);
    expect(result.collectedArtifactsCount).toBe(1);
    expect(existsSync(result.workflowRunPath)).toBe(true);
    expect(existsSync(result.testResultsPath)).toBe(true);
    expect(existsSync(result.commitChangesPath)).toBe(true);
    expect(existsSync(result.collectedArtifactsPath)).toBe(true);
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
    expect(importResult.collectedArtifactsImported).toBe(1);
    expect(importResult.samplingRunsImported).toBe(1);
    expect(importResult.samplingRunTestsImported).toBe(2);

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

    const signupHistory = await store2.queryTestHistory(
      "tests/signup.spec.ts",
      "signup works",
    );
    expect(signupHistory[0].stdout).toBe("signup stdout");
    expect(signupHistory[0].stderr).toBe("signup stderr");
    expect(signupHistory[0].artifactPaths).toEqual([
      "/tmp/flaker/signup.stdout.log",
      "/tmp/flaker/signup.stderr.log",
    ]);

    const changes = await store2.raw<{ file_path: string }>(
      "SELECT file_path FROM commit_changes ORDER BY file_path",
    );
    expect(changes).toHaveLength(2);
    expect(changes[0].file_path).toBe("src/bar.ts");

    const collectedArtifacts = await store2.raw<{
      artifact_name: string;
      artifact_id: number;
      local_archive_path: string;
      artifact_entries: string;
    }>(
      `SELECT artifact_name, artifact_id::INTEGER AS artifact_id, local_archive_path, artifact_entries
       FROM collected_artifacts
       WHERE workflow_run_id = ?`,
      [1],
    );
    expect(collectedArtifacts).toEqual([
      {
        artifact_name: "playwright-report",
        artifact_id: 101,
        local_archive_path: "/tmp/flaker/artifacts/collected/1/playwright-playwright-report.zip",
        artifact_entries: JSON.stringify(["report.json", "trace-blob.bin"]),
      },
    ]);

    const samplingRuns = await store2.raw<{ id: number; commit_sha: string; selected_count: number }>(
      "SELECT id::INTEGER AS id, commit_sha, selected_count::INTEGER AS selected_count FROM sampling_runs",
    );
    expect(samplingRuns).toEqual([
      { id: 1, commit_sha: "sha1", selected_count: 2 },
    ]);

    const samplingTests = await store2.raw<{ ordinal: number; suite: string }>(
      "SELECT ordinal::INTEGER AS ordinal, suite FROM sampling_run_tests ORDER BY ordinal",
    );
    expect(samplingTests).toEqual([
      { ordinal: 0, suite: "tests/login.spec.ts" },
      { ordinal: 1, suite: "tests/signup.spec.ts" },
    ]);

    await store2.close();
  });

  it("syncs sequences after import so later inserts do not collide", async () => {
    await store.insertWorkflowRun({
      id: 2,
      repo: "test/repo",
      branch: "main",
      commitSha: "sha2",
      event: "push",
      status: "completed",
      createdAt: new Date("2026-04-02"),
      durationMs: 45000,
    });
    await store.insertCommitChanges("sha2", [
      { filePath: "src/baz.ts", changeType: "modified", additions: 3, deletions: 1 },
    ]);
    await store.insertTestResults([
      {
        workflowRunId: 2,
        suite: "tests/profile.spec.ts",
        testName: "profile works",
        status: "passed",
        durationMs: 90,
        retryCount: 0,
        errorMessage: null,
        commitSha: "sha2",
        variant: null,
        createdAt: new Date("2026-04-02"),
      },
    ]);
    await recordSamplingRunFromSummary(store, {
      id: 2,
      commitSha: "sha2",
      commandKind: "run",
      summary: {
        strategy: "weighted",
        requestedCount: 1,
        requestedPercentage: null,
        seed: 8,
        changedFiles: ["src/baz.ts"],
        candidateCount: 3,
        selectedCount: 1,
        sampleRatio: 33.3,
        estimatedSavedTests: 2,
        estimatedSavedMinutes: 0.8,
        fallbackReason: null,
      },
      tests: [
        {
          suite: "tests/profile.spec.ts",
          testName: "profile works",
          testId: "tests/profile.spec.ts::profile works",
        },
      ],
    });
    await store.exportRunToParquet(2, tmpDir);

    const store2 = new DuckDBStore(":memory:");
    await store2.initialize();
    await store2.insertWorkflowRun({
      id: 1,
      repo: "test/repo",
      branch: "main",
      commitSha: "sha1",
      event: "push",
      status: "completed",
      createdAt: new Date("2026-04-01"),
      durationMs: 60000,
    });
    await store2.insertTestResults([
      {
        workflowRunId: 1,
        suite: "tests/login.spec.ts",
        testName: "login works",
        status: "passed",
        durationMs: 150,
        retryCount: 0,
        errorMessage: null,
        commitSha: "sha1",
        variant: null,
        createdAt: new Date("2026-04-01"),
      },
      {
        workflowRunId: 1,
        suite: "tests/signup.spec.ts",
        testName: "signup works",
        status: "failed",
        durationMs: 200,
        retryCount: 1,
        errorMessage: "timeout",
        commitSha: "sha1",
        variant: null,
        createdAt: new Date("2026-04-01"),
      },
    ]);
    await recordSamplingRunFromSummary(store2, {
      id: 1,
      commitSha: "sha1",
      commandKind: "run",
      summary: {
        strategy: "hybrid",
        requestedCount: 2,
        requestedPercentage: null,
        seed: 7,
        changedFiles: ["src/foo.ts"],
        candidateCount: 4,
        selectedCount: 2,
        sampleRatio: 50,
        estimatedSavedTests: 2,
        estimatedSavedMinutes: 1.1,
        fallbackReason: null,
      },
      tests: [
        {
          suite: "tests/login.spec.ts",
          testName: "login works",
          testId: "tests/login.spec.ts::login works",
        },
      ],
    });

    await store2.importFromParquetDir(tmpDir);

    await store2.insertWorkflowRun({
      id: 3,
      repo: "test/repo",
      branch: "main",
      commitSha: "sha3",
      event: "push",
      status: "completed",
      createdAt: new Date("2026-04-03"),
      durationMs: 30000,
    });
    await expect(store2.insertTestResults([
      {
        workflowRunId: 3,
        suite: "tests/settings.spec.ts",
        testName: "settings works",
        status: "passed",
        durationMs: 75,
        retryCount: 0,
        errorMessage: null,
        commitSha: "sha3",
        variant: null,
        createdAt: new Date("2026-04-03"),
      },
    ])).resolves.toBeUndefined();
    await expect(recordSamplingRunFromSummary(store2, {
      commitSha: "sha3",
      commandKind: "sample",
      summary: {
        strategy: "weighted",
        requestedCount: 1,
        requestedPercentage: null,
        seed: 9,
        changedFiles: ["src/settings.ts"],
        candidateCount: 5,
        selectedCount: 1,
        sampleRatio: 20,
        estimatedSavedTests: 4,
        estimatedSavedMinutes: 2.4,
        fallbackReason: null,
      },
      tests: [
        {
          suite: "tests/settings.spec.ts",
          testName: "settings works",
          testId: "tests/settings.spec.ts::settings works",
        },
      ],
    })).resolves.toBeUndefined();

    const testResultCount = await store2.raw<{ cnt: number }>(
      "SELECT COUNT(*)::INTEGER AS cnt FROM test_results",
    );
    expect(testResultCount[0].cnt).toBe(4);

    const samplingRunCount = await store2.raw<{ cnt: number }>(
      "SELECT COUNT(*)::INTEGER AS cnt FROM sampling_runs",
    );
    expect(samplingRunCount[0].cnt).toBe(3);

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
