import type { TestCaseResult } from "../adapters/types.js";
import { junitAdapter } from "../adapters/junit.js";
import { playwrightAdapter } from "../adapters/playwright.js";
import { normalizeVariant, resolveTestIdentity } from "../identity.js";

export interface ReportTotals {
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  retries: number;
  durationMs: number;
}

export interface ReportTestSummary {
  testId: string;
  suite: string;
  testName: string;
  taskId: string;
  filter: string | null;
  variant: Record<string, string> | null;
  status: TestCaseResult["status"];
  durationMs: number;
  retryCount: number;
  errorMessage?: string;
}

export interface ReportFileSummary {
  suite: string;
  totals: ReportTotals;
}

export interface NormalizedReportSummary {
  adapter: string;
  totals: ReportTotals;
  files: ReportFileSummary[];
  unstable: ReportTestSummary[];
  tests: ReportTestSummary[];
}

export interface ReportDiffEntry {
  testId: string;
  suite: string;
  testName: string;
  taskId: string;
  filter: string | null;
  variant: Record<string, string> | null;
  baseStatus: TestCaseResult["status"] | null;
  headStatus: TestCaseResult["status"] | null;
}

export interface ReportDiff {
  baseAdapter: string;
  headAdapter: string;
  summary: {
    newFailureCount: number;
    newFlakyCount: number;
    resolvedFailureCount: number;
    resolvedFlakyCount: number;
    persistentFlakyCount: number;
  };
  regressions: {
    newFailures: ReportDiffEntry[];
    newFlaky: ReportDiffEntry[];
  };
  improvements: {
    resolvedFailures: ReportDiffEntry[];
    resolvedFlaky: ReportDiffEntry[];
  };
  persistent: {
    persistentFlaky: ReportDiffEntry[];
  };
}

function emptyTotals(): ReportTotals {
  return {
    total: 0,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    retries: 0,
    durationMs: 0,
  };
}

function compareNullable(a: string | null, b: string | null): number {
  return (a ?? "").localeCompare(b ?? "");
}

function variantLabel(variant: Record<string, string> | null): string {
  return JSON.stringify(variant ?? {});
}

function sortTests<T extends { suite: string; testName: string; taskId: string; filter: string | null; variant: Record<string, string> | null }>(
  entries: T[],
): T[] {
  return [...entries].sort((a, b) => {
    const bySuite = a.suite.localeCompare(b.suite);
    if (bySuite !== 0) return bySuite;
    const byName = a.testName.localeCompare(b.testName);
    if (byName !== 0) return byName;
    const byTask = a.taskId.localeCompare(b.taskId);
    if (byTask !== 0) return byTask;
    const byFilter = compareNullable(a.filter, b.filter);
    if (byFilter !== 0) return byFilter;
    return variantLabel(a.variant).localeCompare(variantLabel(b.variant));
  });
}

function addToTotals(
  totals: ReportTotals,
  entry: Pick<ReportTestSummary, "status" | "retryCount" | "durationMs">,
): void {
  totals.total += 1;
  totals[entry.status] += 1;
  totals.retries += entry.retryCount;
  totals.durationMs += entry.durationMs;
}

function summarizeTest(result: TestCaseResult): ReportTestSummary {
  const resolved = resolveTestIdentity({
    suite: result.suite,
    testName: result.testName,
    taskId: result.taskId,
    filter: result.filter,
    variant: result.variant,
  });

  return {
    testId: resolved.testId,
    suite: resolved.suite,
    testName: resolved.testName,
    taskId: resolved.taskId,
    filter: resolved.filter,
    variant: normalizeVariant(resolved.variant),
    status: result.status,
    durationMs: result.durationMs,
    retryCount: result.retryCount,
    ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
  };
}

export function summarizeResults(
  results: TestCaseResult[],
  adapter: string,
): NormalizedReportSummary {
  const tests = sortTests(results.map(summarizeTest));
  const totals = emptyTotals();
  const fileTotals = new Map<string, ReportTotals>();

  for (const test of tests) {
    addToTotals(totals, test);
    const existing = fileTotals.get(test.suite);
    if (existing) {
      addToTotals(existing, test);
    } else {
      const next = emptyTotals();
      addToTotals(next, test);
      fileTotals.set(test.suite, next);
    }
  }

  return {
    adapter,
    totals,
    files: [...fileTotals.entries()]
      .map(([suite, totals]) => ({ suite, totals }))
      .sort((a, b) => a.suite.localeCompare(b.suite)),
    unstable: tests.filter((test) => test.status === "failed" || test.status === "flaky"),
    tests,
  };
}

function parseAdapterReport(
  adapter: string,
  input: string,
): TestCaseResult[] {
  switch (adapter) {
    case "playwright":
      return playwrightAdapter.parse(input);
    case "junit":
      return junitAdapter.parse(input);
    default:
      throw new Error(`Unsupported adapter: ${adapter}`);
  }
}

export function runReportSummarize(opts: {
  adapter: string;
  input: string;
}): NormalizedReportSummary {
  return summarizeResults(parseAdapterReport(opts.adapter, opts.input), opts.adapter);
}

export function parseReportSummary(input: string): NormalizedReportSummary {
  return JSON.parse(input) as NormalizedReportSummary;
}

function toDiffEntry(
  base: ReportTestSummary | null,
  head: ReportTestSummary | null,
): ReportDiffEntry {
  const source = head ?? base;
  if (!source) {
    throw new Error("Diff entry requires either base or head");
  }

  return {
    testId: source.testId,
    suite: source.suite,
    testName: source.testName,
    taskId: source.taskId,
    filter: source.filter,
    variant: source.variant,
    baseStatus: base?.status ?? null,
    headStatus: head?.status ?? null,
  };
}

export function runReportDiff(opts: {
  base: NormalizedReportSummary;
  head: NormalizedReportSummary;
}): ReportDiff {
  const baseById = new Map(opts.base.tests.map((test) => [test.testId, test]));
  const headById = new Map(opts.head.tests.map((test) => [test.testId, test]));
  const allIds = new Set<string>([
    ...baseById.keys(),
    ...headById.keys(),
  ]);

  const newFailures: ReportDiffEntry[] = [];
  const newFlaky: ReportDiffEntry[] = [];
  const resolvedFailures: ReportDiffEntry[] = [];
  const resolvedFlaky: ReportDiffEntry[] = [];
  const persistentFlaky: ReportDiffEntry[] = [];

  for (const testId of allIds) {
    const base = baseById.get(testId) ?? null;
    const head = headById.get(testId) ?? null;
    const baseStatus = base?.status ?? null;
    const headStatus = head?.status ?? null;

    if (headStatus === "failed" && baseStatus !== "failed") {
      newFailures.push(toDiffEntry(base, head));
    }

    if (headStatus === "flaky") {
      if (baseStatus === "flaky") {
        persistentFlaky.push(toDiffEntry(base, head));
      } else if (baseStatus !== "failed") {
        newFlaky.push(toDiffEntry(base, head));
      }
    }

    if (baseStatus === "failed" && headStatus !== "failed" && headStatus !== null) {
      resolvedFailures.push(toDiffEntry(base, head));
    }

    if (baseStatus === "flaky" && headStatus !== "flaky" && headStatus !== null) {
      resolvedFlaky.push(toDiffEntry(base, head));
    }
  }

  return {
    baseAdapter: opts.base.adapter,
    headAdapter: opts.head.adapter,
    summary: {
      newFailureCount: newFailures.length,
      newFlakyCount: newFlaky.length,
      resolvedFailureCount: resolvedFailures.length,
      resolvedFlakyCount: resolvedFlaky.length,
      persistentFlakyCount: persistentFlaky.length,
    },
    regressions: {
      newFailures: sortTests(newFailures),
      newFlaky: sortTests(newFlaky),
    },
    improvements: {
      resolvedFailures: sortTests(resolvedFailures),
      resolvedFlaky: sortTests(resolvedFlaky),
    },
    persistent: {
      persistentFlaky: sortTests(persistentFlaky),
    },
  };
}

function formatTotals(totals: ReportTotals): string[] {
  return [
    `- Total: ${totals.total}`,
    `- Passed: ${totals.passed}`,
    `- Failed: ${totals.failed}`,
    `- Flaky: ${totals.flaky}`,
    `- Skipped: ${totals.skipped}`,
    `- Retries: ${totals.retries}`,
    `- DurationMs: ${totals.durationMs}`,
  ];
}

function formatTestRows(
  entries: Array<Pick<ReportDiffEntry, "suite" | "testName" | "taskId" | "filter" | "baseStatus" | "headStatus">>,
): string[] {
  return entries.map(
    (entry) =>
      `| ${entry.suite} | ${entry.testName} | ${entry.taskId} | ${entry.filter ?? "-"} | ${entry.baseStatus ?? "-"} | ${entry.headStatus ?? "-"} |`,
  );
}

function formatSummaryTestRows(
  entries: ReportTestSummary[],
): string[] {
  return entries.map(
    (entry) =>
      `| ${entry.suite} | ${entry.testName} | ${entry.taskId} | ${entry.filter ?? "-"} | ${entry.status} | ${entry.retryCount} |`,
  );
}

function formatReportSection(title: string, rows: string[]): string[] {
  const lines = [`## ${title}`, ""];
  if (rows.length === 0) {
    lines.push("_None_", "");
    return lines;
  }
  lines.push(...rows, "");
  return lines;
}

export function formatReportSummary(
  summary: NormalizedReportSummary,
  format: "json" | "markdown",
): string {
  if (format === "json") {
    return JSON.stringify(summary, null, 2);
  }

  const fileRows = summary.files.map(
    (file) =>
      `| ${file.suite} | ${file.totals.total} | ${file.totals.passed} | ${file.totals.failed} | ${file.totals.flaky} | ${file.totals.skipped} | ${file.totals.retries} |`,
  );

  return [
    "# Test Report Summary",
    "",
    `- Adapter: ${summary.adapter}`,
    ...formatTotals(summary.totals),
    "",
    "## Files",
    "",
    "| suite | total | passed | failed | flaky | skipped | retries |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...fileRows,
    "",
    ...formatReportSection(
      "Unstable Tests",
      summary.unstable.length > 0
        ? [
            "| suite | testName | taskId | filter | status | retries |",
            "| --- | --- | --- | --- | --- | --- |",
            ...formatSummaryTestRows(summary.unstable),
          ]
        : [],
    ),
  ].join("\n");
}

export function formatReportDiff(
  diff: ReportDiff,
  format: "json" | "markdown",
): string {
  if (format === "json") {
    return JSON.stringify(diff, null, 2);
  }

  return [
    "# Test Report Diff",
    "",
    `- Base adapter: ${diff.baseAdapter}`,
    `- Head adapter: ${diff.headAdapter}`,
    `- New failures: ${diff.summary.newFailureCount}`,
    `- New flaky: ${diff.summary.newFlakyCount}`,
    `- Resolved failures: ${diff.summary.resolvedFailureCount}`,
    `- Resolved flaky: ${diff.summary.resolvedFlakyCount}`,
    `- Persistent flaky: ${diff.summary.persistentFlakyCount}`,
    "",
    ...formatReportSection(
      "New Failures",
      diff.regressions.newFailures.length > 0
        ? [
            "| suite | testName | taskId | filter | baseStatus | headStatus |",
            "| --- | --- | --- | --- | --- | --- |",
            ...formatTestRows(diff.regressions.newFailures),
          ]
        : [],
    ),
    ...formatReportSection(
      "New Flaky",
      diff.regressions.newFlaky.length > 0
        ? [
            "| suite | testName | taskId | filter | baseStatus | headStatus |",
            "| --- | --- | --- | --- | --- | --- |",
            ...formatTestRows(diff.regressions.newFlaky),
          ]
        : [],
    ),
    ...formatReportSection(
      "Resolved Failures",
      diff.improvements.resolvedFailures.length > 0
        ? [
            "| suite | testName | taskId | filter | baseStatus | headStatus |",
            "| --- | --- | --- | --- | --- | --- |",
            ...formatTestRows(diff.improvements.resolvedFailures),
          ]
        : [],
    ),
    ...formatReportSection(
      "Resolved Flaky",
      diff.improvements.resolvedFlaky.length > 0
        ? [
            "| suite | testName | taskId | filter | baseStatus | headStatus |",
            "| --- | --- | --- | --- | --- | --- |",
            ...formatTestRows(diff.improvements.resolvedFlaky),
          ]
        : [],
    ),
    ...formatReportSection(
      "Persistent Flaky",
      diff.persistent.persistentFlaky.length > 0
        ? [
            "| suite | testName | taskId | filter | baseStatus | headStatus |",
            "| --- | --- | --- | --- | --- | --- |",
            ...formatTestRows(diff.persistent.persistentFlaky),
          ]
        : [],
    ),
  ].join("\n");
}
