import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { TestResult, WorkflowRun } from "../../src/cli/storage/types.js";
import { runAnalysisBundle } from "../../src/cli/commands/analyze/bundle.js";

function makeRun(
  id: number,
  commitSha: string,
  createdAt: Date,
  overrides?: Partial<WorkflowRun>,
): WorkflowRun {
  return {
    id,
    repo: "owner/repo",
    branch: "main",
    commitSha,
    event: "push",
    source: "ci",
    status: "success",
    createdAt,
    durationMs: 60_000,
    ...overrides,
  };
}

function makeResult(
  workflowRunId: number,
  suite: string,
  testName: string,
  status: string,
  commitSha: string,
  createdAt: Date,
  overrides?: Partial<TestResult>,
): TestResult {
  return {
    workflowRunId,
    suite,
    testName,
    status,
    durationMs: 100,
    retryCount: 0,
    errorMessage: status === "failed" ? "boom" : null,
    commitSha,
    variant: null,
    createdAt,
    ...overrides,
  };
}

describe("analysis bundle", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("builds a machine-readable bundle for AI consumers", async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    await store.insertWorkflowRun(makeRun(1, "sha-ci-1", yesterday, {
      source: "ci",
      event: "push",
    }));
    await store.insertWorkflowRun(makeRun(2, "sha-ci-2", now, {
      source: "ci",
      event: "push",
    }));
    await store.insertWorkflowRun(makeRun(3, "sha-local-1", now, {
      source: "local",
      branch: "local",
      event: "local-import",
    }));
    await store.recordCollectedArtifact({
      workflowRunId: 2,
      adapterType: "playwright",
      artifactName: "playwright-report",
      adapterConfig: "",
      artifactId: 2202,
      localArchivePath: "/tmp/flaker/artifacts/collected/2/playwright-playwright-report.zip",
      artifactEntries: [
        "report.json",
        "trace-blob.bin",
        "failure-image.bin",
      ],
    });

    await store.insertTestResults([
      makeResult(1, "tests/a.spec.ts", "test a", "failed", "sha-ci-1", yesterday, {
        retryCount: 1,
        errorMessage: "AssertionError: boom\n    at renderCi (/workspace/src/render-ci.ts:21:5)",
        stdout: "ci stdout 1",
        stderr: "ci stderr 1",
        artifactPaths: [
          "/artifacts/ci/run-1/stdout.log",
          "/artifacts/ci/run-1/trace.zip",
        ],
        variant: { browser: "chromium" },
      }),
      makeResult(1, "tests/b.spec.ts", "test b", "failed", "sha-ci-1", yesterday),
      makeResult(2, "tests/a.spec.ts", "test a", "failed", "sha-ci-2", now, {
        errorMessage: "AssertionError: boom\n    at renderCi (/workspace/src/render-ci.ts:22:7)",
        stdout: "ci stdout 2",
        stderr: "ci stderr 2",
        artifactPaths: [
          "/artifacts/ci/run-2/stdout.log",
          "/artifacts/ci/run-2/stderr.log",
          "/artifacts/ci/run-2/trace-blob.bin",
          "/artifacts/ci/run-2/failure-image.bin",
          "/artifacts/ci/run-2/test-results.json",
        ],
        artifacts: [
          {
            path: "/artifacts/ci/run-2/trace-blob.bin",
            fileName: "trace-blob.bin",
            kind: "trace",
            contentType: "application/zip",
          },
          {
            path: "/artifacts/ci/run-2/failure-image.bin",
            fileName: "failure-image.bin",
            kind: "screenshot",
            contentType: "image/png",
          },
        ],
        variant: { browser: "chromium" },
      }),
      makeResult(2, "tests/b.spec.ts", "test b", "failed", "sha-ci-2", now),
      makeResult(2, "tests/c.spec.ts", "stable", "passed", "sha-ci-2", now),
      makeResult(3, "tests/a.spec.ts", "test a", "failed", "sha-local-1", now, {
        errorMessage: "AssertionError: boom\n    at renderWidget (/workspace/src/render.ts:42:7)\n    at /workspace/tests/a.spec.ts:10:3",
        stdout: "local stdout",
        stderr: "local stderr",
        artifactPaths: [
          "/artifacts/local/run-1/stdout.log",
          "/artifacts/local/run-1/stderr.log",
          "/artifacts/local/run-1/trace-blob.bin",
          "/artifacts/local/run-1/failure-image.bin",
        ],
        artifacts: [
          {
            path: "/artifacts/local/run-1/trace-blob.bin",
            fileName: "trace-blob.bin",
            kind: "trace",
            contentType: "application/zip",
          },
          {
            path: "/artifacts/local/run-1/failure-image.bin",
            fileName: "failure-image.bin",
            kind: "screenshot",
            contentType: "image/png",
          },
        ],
        failureLocation: {
          file: "/workspace/src/render-adapter.ts",
          line: 120,
          column: 9,
          functionName: "renderWidgetFromAdapter",
          raw: "/workspace/src/render-adapter.ts:120:9",
        },
        variant: { browser: "chromium" },
        quarantine: {
          id: "known-flake",
          taskId: "web",
          spec: "tests/a.spec.ts",
          titlePattern: "test a",
          mode: "allow_failure",
          scope: "flaky",
          owner: "qa",
          reason: "known flaky timeout",
          condition: "always",
          introducedAt: "2026-04-01",
          expiresAt: "2026-04-30",
        },
      }),
      makeResult(3, "tests/c.spec.ts", "stable", "passed", "sha-local-1", now),
    ]);

    const bundle = await runAnalysisBundle({
      store,
      storagePath: "/tmp/flaker/data.duckdb",
      resolverConfigured: false,
      windowDays: 30,
    });

    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.data.workflowRuns.total).toBe(3);
    expect(bundle.data.workflowRuns.ci).toBe(2);
    expect(bundle.data.workflowRuns.local).toBe(1);
    expect(bundle.data.testResults.total).toBe(7);
    expect(bundle.data.recentFailures.length).toBeGreaterThan(0);
    expect(bundle.data.recentFailures[0]?.source).toMatch(/^(ci|local)$/);
    expect(bundle.data.recentFailures[0]?.stdout).toBe("local stdout");
    expect(bundle.data.recentFailures[0]?.stderr).toBe("local stderr");
    expect(bundle.data.recentFailures[0]?.artifactPaths).toEqual([
      "/artifacts/local/run-1/stdout.log",
      "/artifacts/local/run-1/stderr.log",
      "/artifacts/local/run-1/trace-blob.bin",
      "/artifacts/local/run-1/failure-image.bin",
    ]);
    expect(bundle.data.recentFailures[0]?.failureLocation).toEqual({
      file: "/workspace/src/render-adapter.ts",
      line: 120,
      column: 9,
      functionName: "renderWidgetFromAdapter",
      raw: "/workspace/src/render-adapter.ts:120:9",
    });
    expect(bundle.data.recentFailures[0]?.artifacts).toEqual([
      {
        path: "/artifacts/local/run-1/stdout.log",
        fileName: "stdout.log",
        kind: "stdout",
        contentType: null,
      },
      {
        path: "/artifacts/local/run-1/stderr.log",
        fileName: "stderr.log",
        kind: "stderr",
        contentType: null,
      },
      {
        path: "/artifacts/local/run-1/trace-blob.bin",
        fileName: "trace-blob.bin",
        kind: "trace",
        contentType: "application/zip",
      },
      {
        path: "/artifacts/local/run-1/failure-image.bin",
        fileName: "failure-image.bin",
        kind: "screenshot",
        contentType: "image/png",
      },
    ]);
    expect(bundle.analysis.kpi.windowDays).toBe(30);
    expect(bundle.analysis.context.environment.testCount).toBe(7);
    expect(bundle.analysis.reason.summary.totalAnalyzed).toBeGreaterThan(0);
    expect(bundle.analysis.insights.summary.totalTests).toBeGreaterThan(0);
    expect(bundle.analysis.clusters.length).toBe(1);
    expect(bundle.analysis.clusters[0]?.members).toHaveLength(2);

    const ciRecentFailure = bundle.data.recentFailures.find((entry) =>
      entry.commitSha === "sha-ci-2"
      && entry.suite === "tests/a.spec.ts"
      && entry.testName === "test a"
    );
    expect(ciRecentFailure?.workflowRunId).toBe(2);
    expect(ciRecentFailure?.workflowArtifacts).toEqual([
      {
        workflowRunId: 2,
        repo: "owner/repo",
        source: "ci",
        adapterType: "playwright",
        adapterConfig: "",
        artifactName: "playwright-report",
        artifactId: 2202,
        localArchivePath: "/tmp/flaker/artifacts/collected/2/playwright-playwright-report.zip",
        entryNames: [
          "report.json",
          "trace-blob.bin",
          "failure-image.bin",
        ],
        downloadCommand: "gh run download 2 --repo owner/repo --name playwright-report",
      },
    ]);
    expect(ciRecentFailure?.relatedWorkflowArtifacts).toEqual([
      {
        workflowRunId: 2,
        repo: "owner/repo",
        source: "ci",
        adapterType: "playwright",
        adapterConfig: "",
        artifactName: "playwright-report",
        artifactId: 2202,
        localArchivePath: "/tmp/flaker/artifacts/collected/2/playwright-playwright-report.zip",
        entryNames: [
          "report.json",
          "trace-blob.bin",
          "failure-image.bin",
        ],
        matchedEntries: [
          "trace-blob.bin",
          "failure-image.bin",
        ],
        matchedArtifacts: [
          {
            path: "/artifacts/ci/run-2/trace-blob.bin",
            fileName: "trace-blob.bin",
            kind: "trace",
            contentType: "application/zip",
          },
          {
            path: "/artifacts/ci/run-2/failure-image.bin",
            fileName: "failure-image.bin",
            kind: "screenshot",
            contentType: "image/png",
          },
        ],
        downloadCommand: "gh run download 2 --repo owner/repo --name playwright-report",
      },
    ]);

    const testAEvidence = bundle.data.failureEvidence.find((entry) =>
      entry.suite === "tests/a.spec.ts" && entry.testName === "test a"
    );
    expect(testAEvidence).toBeDefined();
    expect(testAEvidence?.failureSignals).toBe(3);
    expect(testAEvidence?.failureRate).toBe(100);
    expect(testAEvidence?.isQuarantined).toBe(true);
    expect(testAEvidence?.sources).toEqual(["ci", "local"]);
    expect(testAEvidence?.variantsSeen).toEqual([{ browser: "chromium" }]);
    expect(testAEvidence?.activeQuarantines[0]?.id).toBe("known-flake");
    expect(testAEvidence?.sampleErrors[0]?.fingerprint).toBe("AssertionError: boom");
    expect(testAEvidence?.sampleErrors[0]?.count).toBe(3);
    expect(testAEvidence?.recentHistory[0]?.source).toBe("local");
    expect(testAEvidence?.recentHistory[0]?.stdout).toBe("local stdout");
    expect(testAEvidence?.recentHistory[0]?.stderr).toBe("local stderr");
    expect(testAEvidence?.recentHistory[0]?.artifactPaths).toEqual([
      "/artifacts/local/run-1/stdout.log",
      "/artifacts/local/run-1/stderr.log",
      "/artifacts/local/run-1/trace-blob.bin",
      "/artifacts/local/run-1/failure-image.bin",
    ]);
    expect(testAEvidence?.recentHistory[0]?.failureLocation).toEqual({
      file: "/workspace/src/render-adapter.ts",
      line: 120,
      column: 9,
      functionName: "renderWidgetFromAdapter",
      raw: "/workspace/src/render-adapter.ts:120:9",
    });
    expect(testAEvidence?.recentHistory[0]?.artifacts?.map((entry) => entry.kind)).toEqual([
      "stdout",
      "stderr",
      "trace",
      "screenshot",
    ]);
    expect(testAEvidence?.recentHistory[0]?.quarantine?.id).toBe("known-flake");
    const ciHistory = testAEvidence?.recentHistory.find((entry) =>
      entry.commitSha === "sha-ci-2"
    );
    expect(ciHistory?.workflowArtifacts[0]?.artifactName).toBe("playwright-report");
    expect(ciHistory?.workflowArtifacts[0]?.downloadCommand).toBe(
      "gh run download 2 --repo owner/repo --name playwright-report",
    );
    expect(ciHistory?.relatedWorkflowArtifacts).toEqual([
      {
        workflowRunId: 2,
        repo: "owner/repo",
        source: "ci",
        adapterType: "playwright",
        adapterConfig: "",
        artifactName: "playwright-report",
        artifactId: 2202,
        localArchivePath: "/tmp/flaker/artifacts/collected/2/playwright-playwright-report.zip",
        entryNames: [
          "report.json",
          "trace-blob.bin",
          "failure-image.bin",
        ],
        matchedEntries: [
          "trace-blob.bin",
          "failure-image.bin",
        ],
        matchedArtifacts: [
          {
            path: "/artifacts/ci/run-2/trace-blob.bin",
            fileName: "trace-blob.bin",
            kind: "trace",
            contentType: "application/zip",
          },
          {
            path: "/artifacts/ci/run-2/failure-image.bin",
            fileName: "failure-image.bin",
            kind: "screenshot",
            contentType: "image/png",
          },
        ],
        downloadCommand: "gh run download 2 --repo owner/repo --name playwright-report",
      },
    ]);
  });

  it("serializes GitHub-scale workflow_run_id (> 2^31) without INT32 overflow", async () => {
    const now = new Date();
    // Real GitHub Actions run IDs are already in the 24-billion range;
    // DuckDB ::INTEGER (INT32, max ~2.15B) used to throw a Conversion Error
    // here. bigIntToNumber at the query boundary must demote BIGINT → Number.
    const realGithubRunId = 24186732768;

    await store.insertWorkflowRun(makeRun(realGithubRunId, "sha-ci", now, {
      source: "ci",
      event: "push",
    }));
    await store.insertTestResults([
      makeResult(realGithubRunId, "tests/a.spec.ts", "big id test", "failed", "sha-ci", now, {
        errorMessage: "boom",
      }),
    ]);

    const bundle = await runAnalysisBundle({
      store,
      storagePath: ":memory:",
      resolverConfigured: false,
    });

    const failure = bundle.data.recentFailures.find((f) => f.testName === "big id test");
    expect(failure).toBeDefined();
    expect(failure?.workflowRunId).toBe(realGithubRunId);
    expect(typeof failure?.workflowRunId).toBe("number");
    // JSON.stringify must succeed (bigint would throw "Do not know how to serialize a BigInt")
    expect(() => JSON.stringify(bundle)).not.toThrow();
  });
});
