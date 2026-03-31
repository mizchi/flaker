import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { MetricStore } from "../../src/cli/storage/types.js";
import {
  collectWorkflowRuns,
  type GitHubClient,
} from "../../src/cli/commands/collect.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureReport = readFileSync(
  join(__dirname, "../fixtures/playwright-report.json"),
  "utf-8",
);

function createMockGitHubClient(
  runs: GitHubClient extends { listWorkflowRuns(): Promise<infer R> }
    ? R["workflow_runs"]
    : never,
  artifactName: string,
  reportContent: string,
): GitHubClient {
  return {
    async listWorkflowRuns() {
      return { total_count: runs.length, workflow_runs: runs };
    },
    async listArtifacts(runId: number) {
      return {
        total_count: 1,
        artifacts: [
          { id: runId * 100, name: artifactName, expired: false },
        ],
      };
    },
    async downloadArtifact(_artifactId: number) {
      return reportContent;
    },
  };
}

describe("collectWorkflowRuns", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("collects workflow runs and test results", async () => {
    const mockRuns = [
      {
        id: 1001,
        head_branch: "main",
        head_sha: "abc123",
        event: "push",
        conclusion: "success",
        created_at: "2025-06-01T00:00:00Z",
        run_started_at: "2025-06-01T00:00:00Z",
        updated_at: "2025-06-01T00:05:00Z",
      },
    ];

    const github = createMockGitHubClient(
      mockRuns,
      "playwright-report",
      fixtureReport,
    );

    const result = await collectWorkflowRuns({
      store,
      github,
      repo: "owner/repo",
      adapterType: "playwright",
      artifactName: "playwright-report",
    });

    expect(result.runsCollected).toBe(1);
    // The fixture has 4 specs with 1 test each
    expect(result.testsCollected).toBe(4);

    // Verify workflow run was stored
    const runs = await store.raw<{ id: number }>(
      "SELECT id FROM workflow_runs WHERE id = ?",
      [1001],
    );
    expect(runs).toHaveLength(1);

    // Verify test results were stored
    const tests = await store.raw<{ count: number }>(
      "SELECT COUNT(*)::INTEGER AS count FROM test_results WHERE workflow_run_id = ?",
      [1001],
    );
    expect(tests[0].count).toBe(4);
  });

  it("skips already collected runs (idempotent)", async () => {
    const mockRuns = [
      {
        id: 2001,
        head_branch: "main",
        head_sha: "def456",
        event: "push",
        conclusion: "success",
        created_at: "2025-06-01T00:00:00Z",
        run_started_at: "2025-06-01T00:00:00Z",
        updated_at: "2025-06-01T00:05:00Z",
      },
    ];

    const github = createMockGitHubClient(
      mockRuns,
      "playwright-report",
      fixtureReport,
    );

    // First collection
    const result1 = await collectWorkflowRuns({
      store,
      github,
      repo: "owner/repo",
      adapterType: "playwright",
      artifactName: "playwright-report",
    });
    expect(result1.runsCollected).toBe(1);
    expect(result1.testsCollected).toBe(4);

    // Second collection - same runs should be skipped
    const result2 = await collectWorkflowRuns({
      store,
      github,
      repo: "owner/repo",
      adapterType: "playwright",
      artifactName: "playwright-report",
    });
    expect(result2.runsCollected).toBe(0);
    expect(result2.testsCollected).toBe(0);

    // Verify only one workflow run in DB
    const runs = await store.raw<{ count: number }>(
      "SELECT COUNT(*)::INTEGER AS count FROM workflow_runs WHERE id = ?",
      [2001],
    );
    expect(runs[0].count).toBe(1);

    // Verify test results were not duplicated
    const tests = await store.raw<{ count: number }>(
      "SELECT COUNT(*)::INTEGER AS count FROM test_results WHERE workflow_run_id = ?",
      [2001],
    );
    expect(tests[0].count).toBe(4);
  });
});
