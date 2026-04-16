import { createStableTestId } from "../../identity.js";
import type { TestResult, FlakyScore, MetricStore } from "../../storage/types.js";
import type { RunnerAdapter, TestId } from "../../runners/types.js";

export interface FlakyTagTriageOpts {
  store: MetricStore;
  runner: RunnerAdapter;
  cwd?: string;
  now?: Date;
  tagPattern: string;
  windowDays: number;
  addThresholdPercentage: number;
  minRuns: number;
  removeAfterConsecutivePasses: number;
}

export interface FlakyTagListedTest {
  testId: string;
  suite: string;
  testName: string;
  taskId: string | null;
  tags: string[];
}

export interface FlakyTagAddCandidate {
  testId: string;
  suite: string;
  testName: string;
  taskId: string | null;
  totalRuns: number;
  failCount: number;
  flakyRetryCount: number;
  flakyRate: number;
  lastFailureAt: string | null;
  recommendedAction: "add-tag";
}

export interface FlakyTagTaggedDecision {
  testId: string;
  suite: string;
  testName: string;
  taskId: string | null;
  tags: string[];
  totalRuns: number;
  failCount: number;
  flakyRetryCount: number;
  consecutivePasses: number;
  lastStatus: string | null;
  lastFailureAt: string | null;
  recommendedAction: "remove-tag" | "keep-tag";
}

export interface FlakyTagTriageReport {
  schemaVersion: 1;
  generatedAt: string;
  tagPattern: string;
  windowDays: number;
  thresholds: {
    addThresholdPercentage: number;
    minRuns: number;
    removeAfterConsecutivePasses: number;
  };
  summary: {
    listedCount: number;
    taggedCount: number;
    addCandidateCount: number;
    removeCandidateCount: number;
    keepTaggedCount: number;
  };
  taggedTests: FlakyTagTaggedDecision[];
  suggestions: {
    add: FlakyTagAddCandidate[];
    remove: FlakyTagTaggedDecision[];
    keep: FlakyTagTaggedDecision[];
  };
}

function triageKey(input: {
  suite: string;
  testName: string;
  taskId?: string | null;
}): string {
  return JSON.stringify({
    suite: input.suite,
    testName: input.testName,
    taskId: input.taskId ?? input.suite,
  });
}

function toListedTest(test: TestId): FlakyTagListedTest {
  return {
    testId: createStableTestId({
      suite: test.suite,
      testName: test.testName,
      taskId: test.taskId,
      filter: test.filter,
      variant: test.variant,
      testId: test.testId,
    }),
    suite: test.suite,
    testName: test.testName,
    taskId: test.taskId ?? null,
    tags: test.tags ? [...test.tags] : [],
  };
}

function isTaggedTest(test: TestId | FlakyTagListedTest, tagPattern: string): boolean {
  const normalizedPattern = tagPattern.trim();
  if (normalizedPattern.length === 0) {
    return false;
  }
  if (test.tags?.some((tag) => tag === normalizedPattern)) {
    return true;
  }
  return test.testName.includes(normalizedPattern);
}

function isUnstableResult(result: Pick<TestResult, "status" | "retryCount">): boolean {
  return result.status === "failed"
    || result.status === "flaky"
    || (result.status === "passed" && result.retryCount > 0);
}

function countConsecutivePasses(history: TestResult[]): number {
  let count = 0;
  for (const row of history) {
    if (row.status !== "passed" || row.retryCount > 0) {
      break;
    }
    count += 1;
  }
  return count;
}

function summarizeTaggedHistory(
  test: FlakyTagListedTest,
  history: TestResult[],
  removeAfterConsecutivePasses: number,
): FlakyTagTaggedDecision {
  const totalRuns = history.length;
  const failCount = history.filter((row) => row.status === "failed").length;
  const flakyRetryCount = history.filter((row) =>
    row.status === "flaky" || (row.status === "passed" && row.retryCount > 0)
  ).length;
  const consecutivePasses = countConsecutivePasses(history);
  const lastFailureAt = history.find((row) => isUnstableResult(row))?.createdAt.toISOString() ?? null;
  const lastStatus = history[0]?.status ?? null;
  return {
    ...test,
    totalRuns,
    failCount,
    flakyRetryCount,
    consecutivePasses,
    lastStatus,
    lastFailureAt,
    recommendedAction:
      consecutivePasses >= removeAfterConsecutivePasses
        ? "remove-tag"
        : "keep-tag",
  };
}

function toAddCandidate(
  score: FlakyScore,
): FlakyTagAddCandidate {
  return {
    testId: score.testId,
    suite: score.suite,
    testName: score.testName,
    taskId: score.taskId ?? null,
    totalRuns: score.totalRuns,
    failCount: score.failCount,
    flakyRetryCount: score.flakyRetryCount,
    flakyRate: score.flakyRate,
    lastFailureAt: score.lastFlakyAt?.toISOString() ?? null,
    recommendedAction: "add-tag",
  };
}

export async function runFlakyTagTriage(
  opts: FlakyTagTriageOpts,
): Promise<FlakyTagTriageReport> {
  const listedTests = (await opts.runner.listTests({ cwd: opts.cwd }))
    .map(toListedTest);
  const listedByKey = new Map(listedTests.map((test) => [triageKey(test), test]));
  const taggedTests = listedTests.filter((test) => isTaggedTest(test, opts.tagPattern));
  const taggedKeySet = new Set(taggedTests.map((test) => triageKey(test)));
  const now = opts.now ?? new Date();
  const cutoff = now.getTime() - opts.windowDays * 24 * 60 * 60 * 1000;

  const taggedDecisions: FlakyTagTaggedDecision[] = [];
  for (const test of taggedTests) {
    const history = (await opts.store.queryTestHistory(test.suite, test.testName))
      .filter((row) => row.createdAt.getTime() >= cutoff);
    taggedDecisions.push(
      summarizeTaggedHistory(test, history, opts.removeAfterConsecutivePasses),
    );
  }
  taggedDecisions.sort((a, b) =>
    a.suite.localeCompare(b.suite)
    || a.testName.localeCompare(b.testName),
  );

  const addCandidates = (await opts.store.queryFlakyTests({ windowDays: opts.windowDays }))
    .filter((score) =>
      score.totalRuns >= opts.minRuns
      && score.flakyRate >= opts.addThresholdPercentage
      && listedByKey.has(triageKey(score))
      && !taggedKeySet.has(triageKey(score))
    )
    .map(toAddCandidate)
    .sort((a, b) =>
      b.flakyRate - a.flakyRate
      || b.totalRuns - a.totalRuns
      || a.suite.localeCompare(b.suite)
      || a.testName.localeCompare(b.testName),
    );

  const remove = taggedDecisions.filter((entry) => entry.recommendedAction === "remove-tag");
  const keep = taggedDecisions.filter((entry) => entry.recommendedAction === "keep-tag");

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    tagPattern: opts.tagPattern,
    windowDays: opts.windowDays,
    thresholds: {
      addThresholdPercentage: opts.addThresholdPercentage,
      minRuns: opts.minRuns,
      removeAfterConsecutivePasses: opts.removeAfterConsecutivePasses,
    },
    summary: {
      listedCount: listedTests.length,
      taggedCount: taggedTests.length,
      addCandidateCount: addCandidates.length,
      removeCandidateCount: remove.length,
      keepTaggedCount: keep.length,
    },
    taggedTests: taggedDecisions,
    suggestions: {
      add: addCandidates,
      remove,
      keep,
    },
  };
}

export function formatFlakyTagTriageReport(
  report: FlakyTagTriageReport,
): string {
  const lines = [
    "# Flaky Tag Triage",
    "",
    `  Tag:                     ${report.tagPattern}`,
    `  Listed tests:            ${report.summary.listedCount}`,
    `  Currently tagged:        ${report.summary.taggedCount}`,
    `  Add tag candidates:      ${report.summary.addCandidateCount}`,
    `  Remove tag candidates:   ${report.summary.removeCandidateCount}`,
    `  Keep tagged:             ${report.summary.keepTaggedCount}`,
  ];

  if (report.suggestions.add.length > 0) {
    lines.push("", "Add tag:");
    for (const entry of report.suggestions.add) {
      lines.push(
        `  ${entry.suite} > ${entry.testName}  ${entry.flakyRate}% (${entry.failCount}+${entry.flakyRetryCount}/${entry.totalRuns})`,
      );
    }
  }

  if (report.suggestions.remove.length > 0) {
    lines.push("", "Remove tag:");
    for (const entry of report.suggestions.remove) {
      lines.push(
        `  ${entry.suite} > ${entry.testName}  ${entry.consecutivePasses} consecutive passes`,
      );
    }
  }

  if (report.suggestions.keep.length > 0) {
    lines.push("", "Keep tagged:");
    for (const entry of report.suggestions.keep) {
      lines.push(
        `  ${entry.suite} > ${entry.testName}  last=${entry.lastStatus ?? "unknown"} passes=${entry.consecutivePasses}`,
      );
    }
  }

  return lines.join("\n");
}
