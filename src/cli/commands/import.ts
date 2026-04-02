import { readFileSync } from "node:fs";
import { playwrightAdapter } from "../adapters/playwright.js";
import { junitAdapter } from "../adapters/junit.js";
import type { TestResultAdapter } from "../adapters/types.js";
import type { MetricStore, WorkflowRun, TestResult } from "../storage/types.js";
import { toStoredTestResult } from "../storage/test-result-mapper.js";

interface ImportOpts {
  store: MetricStore;
  filePath: string;
  adapterType: string;
  commitSha?: string;
  branch?: string;
  repo?: string;
}

interface ImportResult {
  testsImported: number;
}

function getAdapter(type: string): TestResultAdapter {
  if (type === "playwright") return playwrightAdapter;
  if (type === "junit") return junitAdapter;
  throw new Error(`Unknown adapter type: ${type}`);
}

export async function runImport(opts: ImportOpts): Promise<ImportResult> {
  const { store, filePath, adapterType } = opts;
  const adapter = getAdapter(adapterType);

  const content = readFileSync(filePath, "utf-8");
  const testCases = adapter.parse(content);

  if (testCases.length === 0) {
    return { testsImported: 0 };
  }

  // Get commit info from options or use defaults
  const commitSha = opts.commitSha ?? "local-" + Date.now();
  const branch = opts.branch ?? "local";
  const repo = opts.repo ?? "local/local";
  const now = new Date();

  // Create a synthetic workflow run
  const runId = Date.now();
  const workflowRun: WorkflowRun = {
    id: runId,
    repo,
    branch,
    commitSha,
    event: "local-import",
    status: "completed",
    createdAt: now,
    durationMs: null,
  };
  await store.insertWorkflowRun(workflowRun);

  const testResults: TestResult[] = testCases.map((tc) =>
    toStoredTestResult(tc, {
      workflowRunId: runId,
      commitSha,
      createdAt: now,
    }),
  );

  await store.insertTestResults(testResults);
  return { testsImported: testResults.length };
}
