import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  actrunAdapter,
  extractTestReportsFromArtifacts,
  resolveActrunCompletedAt,
  resolveActrunConclusion,
  resolveActrunHeadBranch,
  resolveActrunStartedAt,
  type ActrunRunOutput,
} from "../../adapters/actrun.js";
import { playwrightAdapter } from "../../adapters/playwright.js";
import { junitAdapter } from "../../adapters/junit.js";
import type { MetricStore, WorkflowRun, TestResult } from "../../storage/types.js";
import { toStoredTestResult } from "../../storage/test-result-mapper.js";
import { collectCommitChanges } from "./commit-changes.js";
import { resolveCurrentCommitSha } from "../../core/git.js";
import { exportRunParquet } from "../export-parquet.js";

export interface CollectLocalOpts {
  store: MetricStore;
  last?: number;
  exec?: (cmd: string) => string;
  workspace?: string;
  storagePath?: string;
}

export interface CollectLocalResult {
  runsImported: number;
  testsImported: number;
}

interface ActrunRunListEntry {
  run_id: string;
  conclusion: string;
  status: string;
}

function actrunArtifactDirs(workspace: string, runId: string): string[] {
  return [
    join(workspace, ".actrun", "runs", runId, "artifacts"),
    join(workspace, "_build", "actrun", "runs", runId, "artifacts"),
  ];
}

export async function runCollectLocal(opts: CollectLocalOpts): Promise<CollectLocalResult> {
  const { store } = opts;
  const safeExec = (cmd: string, args: string[]): string => {
    if (opts.exec) return opts.exec(`${cmd} ${args.join(" ")}`);
    const result = spawnSync(cmd, args, { encoding: "utf-8", stdio: ["inherit", "pipe", "inherit"] });
    return result.stdout ?? "";
  };

  // Get list of all actrun runs
  const listJson = safeExec("actrun", ["run", "list", "--json"]);
  const allRuns: ActrunRunListEntry[] = JSON.parse(listJson);

  if (allRuns.length === 0) {
    return { runsImported: 0, testsImported: 0 };
  }

  // Apply --last limit
  const runs = opts.last != null ? allRuns.slice(0, opts.last) : allRuns;

  let runsImported = 0;
  let testsImported = 0;

  for (const entry of runs) {
    // Check if already imported (use actrun-<run_id> as commitSha marker)
    const commitSha = `actrun-${entry.run_id}`;
    const existing = await store.raw<{ cnt: number }>(
      "SELECT COUNT(*)::INTEGER AS cnt FROM workflow_runs WHERE commit_sha = ?",
      [commitSha],
    );
    if (existing[0].cnt > 0) continue;

    // Get full run details
    const viewJson = safeExec("actrun", ["run", "view", entry.run_id, "--json"]);
    const output = JSON.parse(viewJson) as ActrunRunOutput;

    // Try to extract richer test reports from actrun artifacts
    const workspace = opts.workspace ?? process.cwd();
    const artifactDirs = actrunArtifactDirs(workspace, entry.run_id).filter(existsSync);
    let testCases = artifactDirs.length > 0
      ? extractTestReportsFromArtifacts(artifactDirs, {
          playwright: playwrightAdapter,
          junit: junitAdapter,
        })
      : [];

    // Fall back to task-level results if no artifact reports found
    if (testCases.length === 0) {
      testCases = actrunAdapter.parse(viewJson);
    }
    const startedAt = new Date(resolveActrunStartedAt(output));
    const completedAt = new Date(resolveActrunCompletedAt(output));
    const durationMs = completedAt.getTime() - startedAt.getTime();

    // Create workflow run
    const runId = Date.now() + runsImported; // ensure unique
    const workflowRun: WorkflowRun = {
      id: runId,
      repo: "local/local",
      branch: resolveActrunHeadBranch(output),
      commitSha,
      event: "actrun-local",
      source: "local",
      status: resolveActrunConclusion(output),
      createdAt: startedAt,
      durationMs,
    };
    await store.insertWorkflowRun(workflowRun);

    // Insert test results
    if (testCases.length > 0) {
      const testResults: TestResult[] = testCases.map((tc) =>
        toStoredTestResult(tc, {
          workflowRunId: runId,
          commitSha,
          createdAt: startedAt,
        }),
      );
      await store.insertTestResults(testResults);
      testsImported += testResults.length;
    }

    const realCommitSha = resolveCurrentCommitSha(workspace);
    if (realCommitSha) {
      await collectCommitChanges(store, workspace, realCommitSha);
    }
    if (opts.storagePath) {
      await exportRunParquet(store, runId, opts.storagePath);
    }

    runsImported++;
  }

  return { runsImported, testsImported };
}
