import type { SamplingSummary } from "./sample.js";
import type { MetricStore } from "../storage/types.js";

export interface SamplingRunTestInput {
  suite: string;
  test_name?: string;
  testName?: string;
  task_id?: string | null;
  taskId?: string | null;
  filter?: string | null;
  test_id?: string | null;
  testId?: string | null;
}

export interface RecordSamplingRunFromSummaryOpts {
  commitSha?: string | null;
  commandKind: "sample" | "run";
  summary: SamplingSummary;
  tests: SamplingRunTestInput[];
  durationMs?: number | null;
}

export async function recordSamplingRunFromSummary(
  store: MetricStore,
  opts: RecordSamplingRunFromSummaryOpts,
): Promise<void> {
  const samplingRunId = await store.recordSamplingRun({
    commitSha: opts.commitSha ?? null,
    commandKind: opts.commandKind,
    strategy: opts.summary.strategy,
    requestedCount: opts.summary.requestedCount,
    requestedPercentage: opts.summary.requestedPercentage,
    seed: opts.summary.seed,
    changedFiles: opts.summary.changedFiles,
    candidateCount: opts.summary.candidateCount,
    selectedCount: opts.summary.selectedCount,
    sampleRatio: opts.summary.sampleRatio,
    estimatedSavedTests: opts.summary.estimatedSavedTests,
    estimatedSavedMinutes: opts.summary.estimatedSavedMinutes,
    fallbackReason: opts.summary.fallbackReason,
    durationMs: opts.durationMs ?? null,
  });

  await store.recordSamplingRunTests(
    opts.tests.map((test, ordinal) => ({
      samplingRunId,
      ordinal,
      suite: test.suite,
      testName: test.testName ?? test.test_name ?? "",
      taskId: test.taskId ?? test.task_id ?? null,
      filter: test.filter ?? null,
      testId: test.testId ?? test.test_id ?? null,
    })),
  );
}
