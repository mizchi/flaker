import AdmZip from "adm-zip";
import { createTestResultAdapter } from "../adapters/index.js";
import type { TestResultAdapter } from "../adapters/types.js";
import type { MetricStore, WorkflowRun, TestResult } from "../storage/types.js";
import { toStoredTestResult } from "../storage/test-result-mapper.js";

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
  downloadArtifact(artifactId: number): Promise<Buffer>;
}

export interface CollectOpts {
  store: MetricStore;
  github: GitHubClient;
  repo: string;
  adapterType: string;
  artifactName?: string;
  customCommand?: string;
}

export interface CollectResult {
  runsCollected: number;
  testsCollected: number;
}

export function defaultArtifactNameForAdapter(adapterType: string): string {
  switch (adapterType) {
    case "junit":
      return "junit-report";
    case "vrt-migration":
      return "migration-report";
    case "vrt-bench":
      return "bench-report";
    case "custom":
      return "custom-report";
    case "playwright":
    default:
      return "playwright-report";
  }
}

function getAdapter(adapterType: string, customCommand?: string): TestResultAdapter {
  return createTestResultAdapter(adapterType, customCommand);
}

export async function collectWorkflowRuns(
  opts: CollectOpts,
): Promise<CollectResult> {
  const {
    store,
    github,
    repo,
    adapterType,
    customCommand,
  } = opts;
  const artifactName = opts.artifactName ?? defaultArtifactNameForAdapter(adapterType);
  const adapterConfig = customCommand ?? "";

  const adapter = getAdapter(adapterType, customCommand);
  const { workflow_runs } = await github.listWorkflowRuns();

  let runsCollected = 0;
  let testsCollected = 0;

  for (const run of workflow_runs) {
    const existing = await store.hasCollectedArtifact({
      workflowRunId: run.id,
      adapterType,
      artifactName,
      adapterConfig,
    });
    if (existing) {
      continue;
    }

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

    const collectedRecord = {
      workflowRunId: run.id,
      adapterType,
      artifactName,
      adapterConfig,
      collectedAt: new Date(run.created_at),
    };

    const { artifacts } = await github.listArtifacts(run.id);
    const artifact = artifacts.find(
      (a) => a.name === artifactName && !a.expired,
    );
    if (!artifact) {
      runsCollected++;
      continue;
    }

    const zipBuffer = await github.downloadArtifact(artifact.id);
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    let reportContent: string | null = null;
    for (const entry of entries) {
      const name = entry.entryName.toLowerCase();
      if (
        (adapterType === "playwright" || adapterType === "vrt-migration" || adapterType === "vrt-bench")
        && name.endsWith(".json")
      ) {
        reportContent = entry.getData().toString("utf-8");
        break;
      }
      if (adapterType === "junit" && name.endsWith(".xml")) {
        reportContent = entry.getData().toString("utf-8");
        break;
      }
      if (!reportContent) {
        reportContent = entry.getData().toString("utf-8");
      }
    }
    if (!reportContent) {
      runsCollected++;
      continue;
    }

    const testCases = adapter.parse(reportContent);

    const testResults: TestResult[] = testCases.map((tc) =>
      toStoredTestResult(tc, {
        workflowRunId: run.id,
        commitSha: run.head_sha,
        createdAt: new Date(run.created_at),
      }),
    );

    if (testResults.length > 0) {
      await store.insertTestResults(testResults);
    }
    await store.recordCollectedArtifact(collectedRecord);

    runsCollected++;
    testsCollected += testResults.length;
  }

  return { runsCollected, testsCollected };
}
