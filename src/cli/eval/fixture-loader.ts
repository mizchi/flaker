import type { MetricStore } from "../storage/types.js";
import type { FixtureData } from "./fixture-generator.js";

export async function loadFixtureIntoStore(
  store: MetricStore,
  fixture: FixtureData,
): Promise<void> {
  const baseTime = Date.now() - fixture.commits.length * 86400000;

  for (let i = 0; i < fixture.commits.length; i++) {
    const commit = fixture.commits[i];
    const createdAt = new Date(baseTime + i * 86400000);
    const runId = i + 1;

    await store.insertWorkflowRun({
      id: runId,
      repo: "fixture/repo",
      branch: "main",
      commitSha: commit.sha,
      event: "push",
      status: "completed",
      createdAt,
      durationMs: 60000,
    });

    await store.insertCommitChanges(
      commit.sha,
      commit.changedFiles.map((f) => ({
        filePath: f.filePath,
        changeType: f.changeType,
        additions: 10,
        deletions: 5,
      })),
    );

    await store.insertTestResults(
      commit.testResults.map((r) => ({
        workflowRunId: runId,
        suite: r.suite,
        testName: r.testName,
        status: r.status,
        durationMs: 100,
        retryCount: 0,
        errorMessage: r.status === "failed" ? "fixture failure" : null,
        commitSha: commit.sha,
        variant: null,
        createdAt,
      })),
    );
  }
}
