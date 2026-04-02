import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, readFileSync as readTextFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import {
  collectWorkflowRuns,
  defaultArtifactNameForAdapter,
  formatCollectSummary,
  resolveCollectExitCode,
  writeCollectSummary,
  type GitHubClient,
} from "../../src/cli/commands/collect.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureReport = readFileSync(
  join(__dirname, "../fixtures/playwright-report.json"),
  "utf-8",
);
const migrationFixtureReport = readFileSync(
  join(__dirname, "../fixtures/vrt-migration-report.json"),
  "utf-8",
);
const benchFixtureReport = readFileSync(
  join(__dirname, "../fixtures/vrt-bench-report.json"),
  "utf-8",
);

interface MockArtifact {
  name: string;
  content: string;
  expired?: boolean;
  entryName?: string;
}

function createMockGitHubClient(
  runs: GitHubClient extends { listWorkflowRuns(): Promise<infer R> }
    ? R["workflow_runs"]
    : never,
  artifactsByRunId: Record<number, MockArtifact[]>,
): GitHubClient {
  const artifactContents = new Map<number, { content: string; entryName: string }>();

  return {
    async listWorkflowRuns() {
      return { total_count: runs.length, workflow_runs: runs };
    },
    async listArtifacts(runId: number) {
      const artifacts = (artifactsByRunId[runId] ?? []).map((artifact, index) => {
        const id = runId * 100 + index;
        artifactContents.set(id, {
          content: artifact.content,
          entryName: artifact.entryName ?? "report.json",
        });
        return { id, name: artifact.name, expired: artifact.expired ?? false };
      });
      return {
        total_count: artifacts.length,
        artifacts,
      };
    },
    async downloadArtifact(artifactId: number) {
      const artifact = artifactContents.get(artifactId);
      if (!artifact) {
        throw new Error(`Unknown artifact id: ${artifactId}`);
      }
      const zip = new AdmZip();
      zip.addFile(artifact.entryName, Buffer.from(artifact.content));
      return zip.toBuffer();
    },
  };
}

describe("defaultArtifactNameForAdapter", () => {
  it("returns adapter-specific defaults", () => {
    expect(defaultArtifactNameForAdapter("playwright")).toBe("playwright-report");
    expect(defaultArtifactNameForAdapter("junit")).toBe("junit-report");
    expect(defaultArtifactNameForAdapter("vrt-migration")).toBe("migration-report");
    expect(defaultArtifactNameForAdapter("vrt-bench")).toBe("bench-report");
    expect(defaultArtifactNameForAdapter("custom")).toBe("custom-report");
  });
});

describe("formatCollectSummary", () => {
  it("formats collect summaries with failed runs", () => {
    expect(formatCollectSummary({
      runsCollected: 1,
      testsCollected: 3,
      failedRuns: 2,
      failedRunIds: [1007, 1009],
      failures: [
        { runId: 1007, message: "temporary artifact download error" },
        { runId: 1009, message: "invalid zip" },
      ],
    })).toBe("Collected 1 runs, 3 test results, 2 failed runs (1007, 1009)");
  });

  it("returns empty failure details when there are no failures", async () => {
    const mockRuns = [
      {
        id: 1010,
        head_branch: "main",
        head_sha: "ok456",
        event: "workflow_dispatch",
        conclusion: "success",
        created_at: "2025-06-09T00:00:00Z",
        run_started_at: "2025-06-09T00:00:00Z",
        updated_at: "2025-06-09T00:04:00Z",
      },
    ];

    const github = createMockGitHubClient(mockRuns, {
      1010: [{ name: "bench-report", content: benchFixtureReport }],
    });

    const store = new DuckDBStore(":memory:");
    await store.initialize();
    try {
      const result = await collectWorkflowRuns({
        store,
        github,
        repo: "owner/repo",
        adapterType: "vrt-bench",
      });
      expect(result.failures).toEqual([]);
    } finally {
      await store.close();
    }
  });

  it("formats collect summaries as json", () => {
    expect(JSON.parse(formatCollectSummary({
      runsCollected: 1,
      testsCollected: 3,
      failedRuns: 2,
      failedRunIds: [1007, 1009],
      failures: [
        { runId: 1007, message: "temporary artifact download error" },
        { runId: 1009, message: "invalid zip" },
      ],
    }, "json"))).toEqual({
      runsCollected: 1,
      testsCollected: 3,
      failedRuns: 2,
      failedRunIds: [1007, 1009],
      failures: [
        { runId: 1007, message: "temporary artifact download error" },
        { runId: 1009, message: "invalid zip" },
      ],
    });
  });

  it("keeps the summary short when there are no failures", () => {
    expect(formatCollectSummary({
      runsCollected: 1,
      testsCollected: 3,
      failedRuns: 0,
      failedRunIds: [],
      failures: [],
    })).toBe("Collected 1 runs, 3 test results");
  });
});

describe("resolveCollectExitCode", () => {
  it("returns 0 by default even when there are partial failures", () => {
    expect(resolveCollectExitCode({
      runsCollected: 1,
      testsCollected: 3,
      failedRuns: 1,
      failedRunIds: [1007],
      failures: [{ runId: 1007, message: "temporary artifact download error" }],
    })).toBe(0);
  });

  it("returns 1 when failOnErrors is enabled and failures exist", () => {
    expect(resolveCollectExitCode({
      runsCollected: 1,
      testsCollected: 3,
      failedRuns: 1,
      failedRunIds: [1007],
      failures: [{ runId: 1007, message: "temporary artifact download error" }],
    }, { failOnErrors: true })).toBe(1);
  });

  it("returns 0 when failOnErrors is enabled but there are no failures", () => {
    expect(resolveCollectExitCode({
      runsCollected: 1,
      testsCollected: 3,
      failedRuns: 0,
      failedRunIds: [],
      failures: [],
    }, { failOnErrors: true })).toBe(0);
  });
});

describe("writeCollectSummary", () => {
  it("writes collect summaries to a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "flaker-collect-"));
    const outputPath = join(dir, "collect-summary.json");
    writeCollectSummary(outputPath, formatCollectSummary({
      runsCollected: 1,
      testsCollected: 3,
      failedRuns: 1,
      failedRunIds: [1007],
      failures: [{ runId: 1007, message: "temporary artifact download error" }],
    }, "json"));
    expect(existsSync(outputPath)).toBe(true);
    expect(JSON.parse(readTextFileSync(outputPath, "utf-8"))).toEqual({
      runsCollected: 1,
      testsCollected: 3,
      failedRuns: 1,
      failedRunIds: [1007],
      failures: [{ runId: 1007, message: "temporary artifact download error" }],
    });
  });
});

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

    const github = createMockGitHubClient(mockRuns, {
      1001: [{ name: "playwright-report", content: fixtureReport }],
    });

    const result = await collectWorkflowRuns({
      store,
      github,
      repo: "owner/repo",
      adapterType: "playwright",
      artifactName: "playwright-report",
    });

    expect(result.runsCollected).toBe(1);
    expect(result.testsCollected).toBe(4);

    const runs = await store.raw<{ id: number }>(
      "SELECT id FROM workflow_runs WHERE id = ?",
      [1001],
    );
    expect(runs).toHaveLength(1);

    const tests = await store.raw<{ count: number }>(
      "SELECT COUNT(*)::INTEGER AS count FROM test_results WHERE workflow_run_id = ?",
      [1001],
    );
    expect(tests[0].count).toBe(4);
  });

  it("collects built-in vrt migration reports from artifacts", async () => {
    const mockRuns = [
      {
        id: 1002,
        head_branch: "main",
        head_sha: "vrt123",
        event: "workflow_dispatch",
        conclusion: "success",
        created_at: "2025-06-02T00:00:00Z",
        run_started_at: "2025-06-02T00:00:00Z",
        updated_at: "2025-06-02T00:03:00Z",
      },
    ];

    const github = createMockGitHubClient(mockRuns, {
      1002: [{ name: "migration-report", content: migrationFixtureReport }],
    });

    const result = await collectWorkflowRuns({
      store,
      github,
      repo: "owner/repo",
      adapterType: "vrt-migration",
      artifactName: "migration-report",
    });

    expect(result.runsCollected).toBe(1);
    expect(result.testsCollected).toBe(3);

    const tests = await store.raw<{ status: string }>(
      "SELECT status FROM test_results WHERE workflow_run_id = ? ORDER BY test_name",
      [1002],
    );
    expect(tests.map((row) => row.status)).toEqual(["failed", "passed", "passed"]);
  });

  it("uses the default migration artifact name when omitted", async () => {
    const mockRuns = [
      {
        id: 1003,
        head_branch: "main",
        head_sha: "vrt456",
        event: "workflow_dispatch",
        conclusion: "success",
        created_at: "2025-06-03T00:00:00Z",
        run_started_at: "2025-06-03T00:00:00Z",
        updated_at: "2025-06-03T00:03:00Z",
      },
    ];

    const github = createMockGitHubClient(mockRuns, {
      1003: [{ name: "migration-report", content: migrationFixtureReport }],
    });

    const result = await collectWorkflowRuns({
      store,
      github,
      repo: "owner/repo",
      adapterType: "vrt-migration",
    });

    expect(result.runsCollected).toBe(1);
    expect(result.testsCollected).toBe(3);
  });

  it("collects built-in vrt bench reports from artifacts", async () => {
    const mockRuns = [
      {
        id: 1004,
        head_branch: "main",
        head_sha: "bench123",
        event: "workflow_dispatch",
        conclusion: "success",
        created_at: "2025-06-04T00:00:00Z",
        run_started_at: "2025-06-04T00:00:00Z",
        updated_at: "2025-06-04T00:04:00Z",
      },
    ];

    const github = createMockGitHubClient(mockRuns, {
      1004: [{ name: "bench-report", content: benchFixtureReport }],
    });

    const result = await collectWorkflowRuns({
      store,
      github,
      repo: "owner/repo",
      adapterType: "vrt-bench",
    });

    expect(result.runsCollected).toBe(1);
    expect(result.testsCollected).toBe(3);

    const tests = await store.raw<{ status: string }>(
      "SELECT status FROM test_results WHERE workflow_run_id = ? ORDER BY test_name",
      [1004],
    );
    expect(tests.map((row) => row.status)).toEqual(["passed", "failed", "passed"]);
  });

  it("does not let an artifact miss block a later collect with another adapter", async () => {
    const mockRuns = [
      {
        id: 1005,
        head_branch: "main",
        head_sha: "mix123",
        event: "workflow_dispatch",
        conclusion: "success",
        created_at: "2025-06-05T00:00:00Z",
        run_started_at: "2025-06-05T00:00:00Z",
        updated_at: "2025-06-05T00:04:00Z",
      },
    ];

    const github = createMockGitHubClient(mockRuns, {
      1005: [{ name: "bench-report", content: benchFixtureReport }],
    });

    const migrationResult = await collectWorkflowRuns({
      store,
      github,
      repo: "owner/repo",
      adapterType: "vrt-migration",
    });
    expect(migrationResult.runsCollected).toBe(1);
    expect(migrationResult.testsCollected).toBe(0);

    const benchResult = await collectWorkflowRuns({
      store,
      github,
      repo: "owner/repo",
      adapterType: "vrt-bench",
    });
    expect(benchResult.runsCollected).toBe(1);
    expect(benchResult.testsCollected).toBe(3);

    const runCount = await store.raw<{ count: number }>(
      "SELECT COUNT(*)::INTEGER AS count FROM workflow_runs WHERE id = ?",
      [1005],
    );
    expect(runCount[0].count).toBe(1);

    const testCount = await store.raw<{ count: number }>(
      "SELECT COUNT(*)::INTEGER AS count FROM test_results WHERE workflow_run_id = ?",
      [1005],
    );
    expect(testCount[0].count).toBe(3);
  });

  it("retries when the artifact is temporarily missing", async () => {
    const mockRuns = [
      {
        id: 1006,
        head_branch: "main",
        head_sha: "retry123",
        event: "workflow_dispatch",
        conclusion: "success",
        created_at: "2025-06-06T00:00:00Z",
        run_started_at: "2025-06-06T00:00:00Z",
        updated_at: "2025-06-06T00:04:00Z",
      },
    ];

    let listArtifactsCalls = 0;
    const github: GitHubClient = {
      async listWorkflowRuns() {
        return { total_count: mockRuns.length, workflow_runs: mockRuns };
      },
      async listArtifacts(runId: number) {
        listArtifactsCalls += 1;
        if (listArtifactsCalls === 1) {
          return { total_count: 0, artifacts: [] };
        }
        return {
          total_count: 1,
          artifacts: [{ id: runId * 100, name: "bench-report", expired: false }],
        };
      },
      async downloadArtifact() {
        const zip = new AdmZip();
        zip.addFile("report.json", Buffer.from(benchFixtureReport));
        return zip.toBuffer();
      },
    };

    const firstResult = await collectWorkflowRuns({
      store,
      github,
      repo: "owner/repo",
      adapterType: "vrt-bench",
    });
    expect(firstResult.runsCollected).toBe(1);
    expect(firstResult.testsCollected).toBe(0);

    const pendingCount = await store.raw<{ count: number }>(
      "SELECT COUNT(*)::INTEGER AS count FROM collected_artifacts WHERE workflow_run_id = ? AND adapter_type = ?",
      [1006, "vrt-bench"],
    );
    expect(pendingCount[0].count).toBe(0);

    const secondResult = await collectWorkflowRuns({
      store,
      github,
      repo: "owner/repo",
      adapterType: "vrt-bench",
    });
    expect(secondResult.runsCollected).toBe(1);
    expect(secondResult.testsCollected).toBe(3);

    const testCount = await store.raw<{ count: number }>(
      "SELECT COUNT(*)::INTEGER AS count FROM test_results WHERE workflow_run_id = ?",
      [1006],
    );
    expect(testCount[0].count).toBe(3);
  });

  it("continues when one run fails to download its artifact", async () => {
    const mockRuns = [
      {
        id: 1007,
        head_branch: "main",
        head_sha: "err123",
        event: "workflow_dispatch",
        conclusion: "success",
        created_at: "2025-06-07T00:00:00Z",
        run_started_at: "2025-06-07T00:00:00Z",
        updated_at: "2025-06-07T00:04:00Z",
      },
      {
        id: 1008,
        head_branch: "main",
        head_sha: "ok123",
        event: "workflow_dispatch",
        conclusion: "success",
        created_at: "2025-06-08T00:00:00Z",
        run_started_at: "2025-06-08T00:00:00Z",
        updated_at: "2025-06-08T00:04:00Z",
      },
    ];

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const github: GitHubClient = {
      async listWorkflowRuns() {
        return { total_count: mockRuns.length, workflow_runs: mockRuns };
      },
      async listArtifacts(runId: number) {
        return {
          total_count: 1,
          artifacts: [{ id: runId * 100, name: "bench-report", expired: false }],
        };
      },
      async downloadArtifact(artifactId: number) {
        if (artifactId === 100700) {
          throw new Error("temporary artifact download error");
        }
        const zip = new AdmZip();
        zip.addFile("report.json", Buffer.from(benchFixtureReport));
        return zip.toBuffer();
      },
    };

    try {
      const result = await collectWorkflowRuns({
        store,
        github,
        repo: "owner/repo",
        adapterType: "vrt-bench",
      });

      expect(result.runsCollected).toBe(1);
      expect(result.testsCollected).toBe(3);
      expect(result.failedRuns).toBe(1);
      expect(result.failedRunIds).toEqual([1007]);
      expect(result.failures).toEqual([
        { runId: 1007, message: "temporary artifact download error" },
      ]);
      expect(warn).toHaveBeenCalledTimes(1);

      const failedRunCollected = await store.raw<{ count: number }>(
        "SELECT COUNT(*)::INTEGER AS count FROM collected_artifacts WHERE workflow_run_id = ? AND adapter_type = ?",
        [1007, "vrt-bench"],
      );
      expect(failedRunCollected[0].count).toBe(0);

      const succeededRunCollected = await store.raw<{ count: number }>(
        "SELECT COUNT(*)::INTEGER AS count FROM collected_artifacts WHERE workflow_run_id = ? AND adapter_type = ?",
        [1008, "vrt-bench"],
      );
      expect(succeededRunCollected[0].count).toBe(1);

      const failedRunTests = await store.raw<{ count: number }>(
        "SELECT COUNT(*)::INTEGER AS count FROM test_results WHERE workflow_run_id = ?",
        [1007],
      );
      expect(failedRunTests[0].count).toBe(0);

      const succeededRunTests = await store.raw<{ count: number }>(
        "SELECT COUNT(*)::INTEGER AS count FROM test_results WHERE workflow_run_id = ?",
        [1008],
      );
      expect(succeededRunTests[0].count).toBe(3);
    } finally {
      warn.mockRestore();
    }
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

    const github = createMockGitHubClient(mockRuns, {
      2001: [{ name: "playwright-report", content: fixtureReport }],
    });

    const result1 = await collectWorkflowRuns({
      store,
      github,
      repo: "owner/repo",
      adapterType: "playwright",
      artifactName: "playwright-report",
    });
    expect(result1.runsCollected).toBe(1);
    expect(result1.testsCollected).toBe(4);

    const result2 = await collectWorkflowRuns({
      store,
      github,
      repo: "owner/repo",
      adapterType: "playwright",
      artifactName: "playwright-report",
    });
    expect(result2.runsCollected).toBe(0);
    expect(result2.testsCollected).toBe(0);

    const runs = await store.raw<{ count: number }>(
      "SELECT COUNT(*)::INTEGER AS count FROM workflow_runs WHERE id = ?",
      [2001],
    );
    expect(runs[0].count).toBe(1);

    const tests = await store.raw<{ count: number }>(
      "SELECT COUNT(*)::INTEGER AS count FROM test_results WHERE workflow_run_id = ?",
      [2001],
    );
    expect(tests[0].count).toBe(4);
  });
});
