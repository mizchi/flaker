import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isGhAvailable } from "../../gh.js";
import type { TestResultAdapter } from "../../adapters/types.js";
import type { RunnerAdapter, TestId } from "../../runners/types.js";

export interface RetryTestResult {
  suite: string;
  testName: string;
  reproduced: boolean;
}

export interface RetryOpts {
  runId?: number;
  repo: string;
  adapter: TestResultAdapter;
  runner: RunnerAdapter;
  artifactName: string;
  cwd?: string;
}

interface CiFailure {
  suite: string;
  testName: string;
}

interface LocalResult {
  suite: string;
  testName: string;
  status: "passed" | "failed";
  durationMs: number;
}

function ghExec(args: string): string {
  return execSync(`gh ${args}`, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function compareRetryResults(
  ciFailures: CiFailure[],
  localResults: LocalResult[],
): RetryTestResult[] {
  return ciFailures.map((failure) => {
    const local = localResults.find(
      (r) => r.suite === failure.suite && r.testName === failure.testName,
    );
    return {
      suite: failure.suite,
      testName: failure.testName,
      reproduced: local?.status === "failed",
    };
  });
}

export function formatRetryReport(runId: number, results: RetryTestResult[]): string {
  const reproduced = results.filter((r) => r.reproduced);
  const notReproduced = results.filter((r) => !r.reproduced);

  const lines = [
    `# Retry: run ${runId} (${results.length} failed test${results.length !== 1 ? "s" : ""})`,
    "",
    "  Results:",
  ];

  for (const r of results) {
    const label = r.reproduced ? "reproduced" : "not reproduced";
    const status = r.reproduced ? "FAIL" : "PASS";
    lines.push(`    ${status}  ${r.suite} > ${r.testName}  (${label})`);
  }

  lines.push("");
  lines.push("  Summary:");
  if (reproduced.length > 0) {
    lines.push(`    Reproduced:     ${reproduced.length}/${results.length}`);
  }
  if (notReproduced.length > 0) {
    lines.push(`    Not reproduced: ${notReproduced.length}/${results.length} (likely CI-specific or flaky)`);
  }

  return lines.join("\n");
}

function getLatestFailedRunId(repo: string): number {
  const output = ghExec(
    `run list --repo=${repo} --status=failure --limit=1 --json databaseId`,
  );
  const runs = JSON.parse(output) as Array<{ databaseId: number }>;
  if (runs.length === 0) {
    throw new Error("No failed runs found in recent workflow runs.");
  }
  return runs[0].databaseId;
}

function downloadRunArtifact(repo: string, runId: number, artifactName: string): string {
  const dir = join(tmpdir(), `flaker-retry-${runId}`);
  try {
    ghExec(`run download ${runId} --repo=${repo} --name=${artifactName} --dir=${dir}`);
  } catch {
    throw new Error(
      `Failed to download artifact "${artifactName}" from run ${runId}. ` +
      "Ensure CI uploads test results as an artifact.",
    );
  }
  return dir;
}

function extractFailedTests(dir: string, adapter: TestResultAdapter): CiFailure[] {
  if (!existsSync(dir)) {
    throw new Error(`Artifact directory not found: ${dir}`);
  }
  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".json") || f.endsWith(".xml"),
  );
  const failures: CiFailure[] = [];

  for (const file of files) {
    const content = readFileSync(join(dir, file), "utf-8");
    try {
      const results = adapter.parse(content);
      for (const r of results) {
        if (r.status === "failed") {
          failures.push({ suite: r.suite, testName: r.testName });
        }
      }
    } catch {
      // Skip unparseable files
    }
  }

  const seen = new Set<string>();
  return failures.filter((f) => {
    const key = `${f.suite}::${f.testName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function runRetry(opts: RetryOpts): Promise<{
  runId: number;
  results: RetryTestResult[];
}> {
  if (!isGhAvailable()) {
    throw new Error("gh CLI is required. Install from https://cli.github.com/");
  }

  const runId = opts.runId ?? getLatestFailedRunId(opts.repo);
  console.log(`  Fetching failed tests from run ${runId}...`);

  const artifactDir = downloadRunArtifact(opts.repo, runId, opts.artifactName);
  const ciFailures = extractFailedTests(artifactDir, opts.adapter);

  if (ciFailures.length === 0) {
    console.log(`  No failed tests found in run ${runId}.`);
    return { runId, results: [] };
  }

  console.log(`  Found ${ciFailures.length} failed test${ciFailures.length !== 1 ? "s" : ""}:`);
  for (const f of ciFailures) {
    console.log(`    ${f.suite} > ${f.testName}`);
  }
  console.log("");
  console.log("  Running locally...");

  const testIds: TestId[] = ciFailures.map((f) => ({
    suite: f.suite,
    testName: f.testName,
  }));

  const execResult = await opts.runner.execute(testIds, { cwd: opts.cwd });

  const localResults: LocalResult[] = execResult.results.map((r) => ({
    suite: r.suite,
    testName: r.testName,
    status: r.status === "failed" ? "failed" as const : "passed" as const,
    durationMs: r.durationMs,
  }));

  const compared = compareRetryResults(ciFailures, localResults);
  return { runId, results: compared };
}
