import { readFileSync } from "node:fs";
import { createTestResultAdapter } from "../../adapters/index.js";
import type { MetricStore, WorkflowRun, TestResult } from "../../storage/types.js";
import { toStoredTestResult } from "../../storage/test-result-mapper.js";
import type { WorkflowRunSource } from "../../run-source.js";
import { importEventForSource } from "../../run-source.js";

interface ImportOpts {
  store: MetricStore;
  filePath: string;
  adapterType: string;
  customCommand?: string;
  commitSha?: string;
  branch?: string;
  repo?: string;
  source?: WorkflowRunSource;
}

interface ImportResult {
  testsImported: number;
}

export async function runImport(opts: ImportOpts): Promise<ImportResult> {
  const { store, filePath, adapterType, customCommand } = opts;
  const adapter = createTestResultAdapter(adapterType, customCommand);

  const content = readFileSync(filePath, "utf-8");
  const testCases = adapter.parse(content);

  if (testCases.length === 0) {
    return { testsImported: 0 };
  }

  const commitSha = opts.commitSha ?? "local-" + Date.now();
  const branch = opts.branch ?? "local";
  const repo = opts.repo ?? "local/local";
  const source = opts.source ?? "local";
  const now = new Date();

  const runId = Date.now();
  const workflowRun: WorkflowRun = {
    id: runId,
    repo,
    branch,
    commitSha,
    event: importEventForSource(source),
    source,
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
