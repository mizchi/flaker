import { playwrightAdapter } from "../adapters/playwright.js";
import type { TestResultAdapter } from "../adapters/types.js";
import type { MetricStore, WorkflowRun, TestResult } from "../storage/types.js";

export interface GitHubClient {
  listWorkflowRuns(): Promise<{
    total_count: number;
    workflow_runs: Array<{
      id: number;
      head_branch: string;
      head_sha: string;
      event: string;
      conclusion: string;
      created_at: string;
      run_started_at: string;
      updated_at: string;
    }>;
  }>;
  listArtifacts(runId: number): Promise<{
    total_count: number;
    artifacts: Array<{ id: number; name: string; expired: boolean }>;
  }>;
  downloadArtifact(artifactId: number): Promise<string>;
}

export interface CollectOpts {
  store: MetricStore;
  github: GitHubClient;
  repo: string;
  adapterType: string;
  artifactName?: string;
}

export interface CollectResult {
  runsCollected: number;
  testsCollected: number;
}

function getAdapter(adapterType: string): TestResultAdapter {
  switch (adapterType) {
    case "playwright":
      return playwrightAdapter;
    default:
      throw new Error(`Unknown adapter type: ${adapterType}`);
  }
}

export async function collectWorkflowRuns(
  opts: CollectOpts,
): Promise<CollectResult> {
  const {
    store,
    github,
    repo,
    adapterType,
    artifactName = "playwright-report",
  } = opts;

  const adapter = getAdapter(adapterType);
  const { workflow_runs } = await github.listWorkflowRuns();

  let runsCollected = 0;
  let testsCollected = 0;

  for (const run of workflow_runs) {
    // Check if already in DB
    const existing = await store.raw<{ id: number }>(
      "SELECT id FROM workflow_runs WHERE id = ?",
      [run.id],
    );
    if (existing.length > 0) {
      continue;
    }

    // Compute duration
    const startedAt = new Date(run.run_started_at);
    const updatedAt = new Date(run.updated_at);
    const durationMs = updatedAt.getTime() - startedAt.getTime();

    const workflowRun: WorkflowRun = {
      id: run.id,
      repo,
      branch: run.head_branch,
      commitSha: run.head_sha,
      event: run.event,
      status: run.conclusion,
      createdAt: new Date(run.created_at),
      durationMs,
    };

    await store.insertWorkflowRun(workflowRun);

    // Find artifact
    const { artifacts } = await github.listArtifacts(run.id);
    const artifact = artifacts.find(
      (a) => a.name === artifactName && !a.expired,
    );
    if (!artifact) {
      runsCollected++;
      continue;
    }

    // Download and parse
    const reportContent = await github.downloadArtifact(artifact.id);
    const testCases = adapter.parse(reportContent);

    const testResults: TestResult[] = testCases.map((tc) => ({
      workflowRunId: run.id,
      suite: tc.suite,
      testName: tc.testName,
      status: tc.status,
      durationMs: tc.durationMs,
      retryCount: tc.retryCount,
      errorMessage: tc.errorMessage ?? null,
      commitSha: run.head_sha,
      variant: tc.variant ?? null,
      createdAt: new Date(run.created_at),
    }));

    if (testResults.length > 0) {
      await store.insertTestResults(testResults);
    }

    runsCollected++;
    testsCollected += testResults.length;
  }

  return { runsCollected, testsCollected };
}
