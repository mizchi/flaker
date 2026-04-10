import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isGhAvailable } from "../../gh.js";
import { computeVerdict, type ConfirmResult } from "./confirm.js";

export interface ConfirmRemoteOpts {
  suite: string;
  testName: string;
  repeat: number;
  repo: string;
  workflow: string;
  adapter: string;
  pollIntervalMs?: number;
}

function ghExec(args: string): string {
  return execSync(`gh ${args}`, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function dispatchWorkflow(opts: ConfirmRemoteOpts): void {
  const args = [
    "workflow", "run", opts.workflow,
    "--repo", opts.repo,
    "-f", `suite=${opts.suite}`,
    "-f", `test_name=${opts.testName}`,
    "-f", `repeat=${opts.repeat}`,
  ];
  ghExec(args.join(" "));
}

function waitForRun(repo: string, workflow: string, pollMs: number): number {
  const sleepMs = Math.min(pollMs, 3000);
  execSync(`sleep ${sleepMs / 1000}`);

  for (let attempt = 0; attempt < 120; attempt++) {
    const output = ghExec(
      `run list --workflow=${workflow} --repo=${repo} --limit=1 --json databaseId,status`,
    );
    const runs = JSON.parse(output) as Array<{ databaseId: number; status: string }>;
    if (runs.length > 0) {
      const run = runs[0];
      if (run.status === "completed") {
        return run.databaseId;
      }
    }
    execSync(`sleep ${pollMs / 1000}`);
  }
  throw new Error("Timed out waiting for workflow run to complete");
}

function downloadArtifact(repo: string, runId: number): string {
  const dir = join(tmpdir(), `flaker-confirm-${runId}`);
  try {
    ghExec(`run download ${runId} --repo=${repo} --name=flaker-confirm-results --dir=${dir}`);
  } catch {
    throw new Error(
      `Failed to download artifact "flaker-confirm-results" from run ${runId}. ` +
      "Ensure the workflow uploads an artifact with that name.",
    );
  }
  return dir;
}

function countFailuresFromArtifact(dir: string): { repeat: number; failures: number } {
  if (!existsSync(dir)) {
    throw new Error(`Artifact directory not found: ${dir}`);
  }

  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  let failures = 0;

  for (const file of files) {
    const content = readFileSync(join(dir, file), "utf-8");
    try {
      const data = JSON.parse(content);
      const hasFailure = Array.isArray(data.testResults) &&
        data.testResults.some((tr: { status?: string }) => tr.status === "failed");
      if (hasFailure) failures++;
    } catch {
      failures++;
    }
  }

  return { repeat: files.length, failures };
}

export async function runConfirmRemote(opts: ConfirmRemoteOpts): Promise<ConfirmResult> {
  if (!isGhAvailable()) {
    throw new Error("gh CLI is not installed. Install from https://cli.github.com/");
  }

  console.log(`  Dispatching ${opts.workflow} on ${opts.repo}...`);
  dispatchWorkflow(opts);

  const pollMs = opts.pollIntervalMs ?? 5000;
  console.log("  Waiting for workflow to complete...");
  const runId = waitForRun(opts.repo, opts.workflow, pollMs);
  console.log(`  Run completed (ID: ${runId}). Downloading results...`);

  const artifactDir = downloadArtifact(opts.repo, runId);
  const { repeat, failures } = countFailuresFromArtifact(artifactDir);

  const effectiveRepeat = repeat > 0 ? repeat : opts.repeat;
  const { verdict, message } = computeVerdict(effectiveRepeat, failures);

  return {
    suite: opts.suite,
    testName: opts.testName,
    runner: "remote",
    repeat: effectiveRepeat,
    failures,
    verdict,
    message,
  };
}
