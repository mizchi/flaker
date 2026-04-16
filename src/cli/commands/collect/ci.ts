import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import AdmZip from "adm-zip";
import { createTestResultAdapter } from "../../adapters/index.js";
import type { TestResultAdapter } from "../../adapters/types.js";
import type { MetricStore, WorkflowRun, TestResult } from "../../storage/types.js";
import { toStoredTestResult } from "../../storage/test-result-mapper.js";
import { collectCommitChanges } from "./commit-changes.js";
import { exportRunParquet } from "../export-parquet.js";

export interface GitHubClient {
  listWorkflowRuns(): Promise<{
    total_count: number;
    workflow_runs: Array<{
      id: number;
      path?: string;
      status?: string;
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
  getCommitFiles?(owner: string, repo: string, sha: string): Promise<Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
  }>>;
}

export interface CollectOpts {
  store: MetricStore;
  github: GitHubClient;
  repo: string;
  adapterType: string;
  artifactName?: string;
  customCommand?: string;
  storagePath?: string;
  workflowPaths?: string[];
}

export interface CollectFailure {
  runId: number;
  message: string;
}

export interface CollectResult {
  runsCollected: number;
  testsCollected: number;
  pendingArtifactRuns: number;
  pendingArtifactRunIds: number[];
  failedRuns: number;
  failedRunIds: number[];
  failures: CollectFailure[];
}

export function formatCollectSummary(
  result: CollectResult,
  format: "text" | "json" = "text",
): string {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }
  const base = `Collected ${result.runsCollected} runs, ${result.testsCollected} test results`;
  const pendingSuffix = result.pendingArtifactRuns > 0
    ? `, ${result.pendingArtifactRuns} pending artifact runs${result.pendingArtifactRunIds.length > 0 ? ` (${result.pendingArtifactRunIds.join(", ")})` : ""}`
    : "";
  if (result.failedRuns === 0) {
    return `${base}${pendingSuffix}`;
  }
  const suffix = result.failedRunIds.length > 0
    ? ` (${result.failedRunIds.join(", ")})`
    : "";
  return `${base}${pendingSuffix}, ${result.failedRuns} failed runs${suffix}`;
}

export function resolveCollectExitCode(
  result: CollectResult,
  opts: { failOnErrors?: boolean } = {},
): number {
  if (!opts.failOnErrors) {
    return 0;
  }
  return result.failedRuns > 0 ? 1 : 0;
}

export function writeCollectSummary(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
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

function sanitizeFileName(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    || "artifact";
}

function persistDownloadedArtifact(
  storagePath: string,
  runId: number,
  adapterType: string,
  artifactName: string,
  zipBuffer: Buffer,
): string {
  const baseDir = resolve(dirname(storagePath), "artifacts", "collected", String(runId));
  mkdirSync(baseDir, { recursive: true });
  const fileName = `${sanitizeFileName(adapterType)}-${sanitizeFileName(artifactName)}.zip`;
  const archivePath = join(baseDir, fileName);
  writeFileSync(archivePath, zipBuffer);
  return archivePath;
}

function getAdapter(adapterType: string, customCommand?: string): TestResultAdapter {
  return createTestResultAdapter(adapterType, customCommand);
}

function shouldFailMissingArtifact(run: { status?: string; conclusion?: string }): boolean {
  return run.status === "completed"
    && typeof run.conclusion === "string"
    && run.conclusion !== "success";
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
    storagePath,
  } = opts;
  const artifactName = opts.artifactName ?? defaultArtifactNameForAdapter(adapterType);
  const adapterConfig = customCommand ?? "";
  const workflowPaths = new Set((opts.workflowPaths ?? []).filter(Boolean));

  const adapter = getAdapter(adapterType, customCommand);
  const { workflow_runs } = await github.listWorkflowRuns();

  let runsCollected = 0;
  let testsCollected = 0;
  let pendingArtifactRuns = 0;
  const pendingArtifactRunIds: number[] = [];
  let failedRuns = 0;
  const failedRunIds: number[] = [];
  const failures: CollectFailure[] = [];

  for (const run of workflow_runs) {
    if (workflowPaths.size > 0) {
      const runPath = run.path?.trim();
      if (!runPath || !workflowPaths.has(runPath)) {
        continue;
      }
    }

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

    try {
      const { artifacts } = await github.listArtifacts(run.id);
      const artifact = artifacts.find(
        (a) => a.name === artifactName && !a.expired,
      );
      if (!artifact) {
        if (shouldFailMissingArtifact(run)) {
          failedRuns++;
          failedRunIds.push(run.id);
          failures.push({
            runId: run.id,
            message:
              `artifact "${artifactName}" was not uploaded for completed workflow run (conclusion=${run.conclusion})`,
          });
          await store.recordCollectedArtifact(collectedRecord);
          continue;
        }
        pendingArtifactRuns++;
        pendingArtifactRunIds.push(run.id);
        continue;
      }

      const zipBuffer = await github.downloadArtifact(artifact.id);
      const localArchivePath = storagePath
        ? persistDownloadedArtifact(storagePath, run.id, adapterType, artifactName, zipBuffer)
        : null;
      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();
      const artifactEntries = entries.map((entry) => entry.entryName);

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
        pendingArtifactRuns++;
        pendingArtifactRunIds.push(run.id);
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
      // Collect commit changes via GitHub API (git diff-tree requires local SHA)
      if (github.getCommitFiles && !await store.hasCommitChanges(run.head_sha)) {
        try {
          const [owner, repoName] = repo.split("/");
          const files = await github.getCommitFiles(owner, repoName, run.head_sha);
          if (files.length > 0) {
            await store.insertCommitChanges(run.head_sha, files.map((f) => ({
              filePath: f.filename,
              changeType: f.status,
              additions: f.additions,
              deletions: f.deletions,
            })));
          }
        } catch {
          // Fall back to local git
          await collectCommitChanges(store, process.cwd(), run.head_sha);
        }
      } else {
        await collectCommitChanges(store, process.cwd(), run.head_sha);
      }
      await store.recordCollectedArtifact({
        ...collectedRecord,
        artifactId: artifact.id,
        localArchivePath,
        artifactEntries,
      });
      if (storagePath) {
        await exportRunParquet(store, run.id, storagePath);
      }

      runsCollected++;
      testsCollected += testResults.length;
    } catch (error) {
      failedRuns++;
      failedRunIds.push(run.id);
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ runId: run.id, message });
      console.warn(`Warning: failed to collect workflow run ${run.id}: ${message}`);
    }
  }

  return {
    runsCollected,
    testsCollected,
    pendingArtifactRuns,
    pendingArtifactRunIds,
    failedRuns,
    failedRunIds,
    failures,
  };
}
