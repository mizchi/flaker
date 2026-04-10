import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { TestCaseResult } from "../../adapters/types.js";
import { createTestResultAdapter } from "../../adapters/index.js";
import { MOONBIT_JS_BRIDGE_URL } from "../../core/build-artifact.js";
import { normalizeVariant, resolveTestIdentity } from "../../identity.js";

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

export interface ReportSummaryArtifactMetadata {
  shard: string | null;
  module: string | null;
  offset: number | null;
  limit: number | null;
  matrix: Record<string, string> | null;
  variant: Record<string, string> | null;
  extra: Record<string, string>;
}

export interface ReportSummaryArtifact {
  summary: NormalizedReportSummary;
  metadata: ReportSummaryArtifactMetadata;
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

export interface ReportAggregateShardSummary {
  shardId: string;
  adapter: string;
  metadata: ReportSummaryArtifactMetadata;
  totals: ReportTotals;
  unstableCount: number;
}

export interface ReportAggregateUnstableTest extends ReportTestSummary {
  shards: string[];
  statuses: Array<"failed" | "flaky">;
}

export interface ReportAggregate {
  summary: {
    shardCount: number;
    unstableCount: number;
  };
  totals: ReportTotals;
  shards: ReportAggregateShardSummary[];
  unstable: ReportAggregateUnstableTest[];
}

interface ReportDiffStatusInput {
  test_id: string;
  base_status: string;
  head_status: string;
}

interface ReportSummaryTestInput {
  test_id: string;
  suite: string;
  status: string;
  duration_ms: number;
  retry_count: number;
}

interface ReportTotalsInput {
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  retries: number;
  duration_ms: number;
}

interface ReportDiffBuckets {
  new_failures: string[];
  new_flaky: string[];
  resolved_failures: string[];
  resolved_flaky: string[];
  persistent_flaky: string[];
}

interface ReportAggregateUnstableStatusInput {
  test_id: string;
  status: string;
}

interface ReportAggregateShardInput {
  shard_id: string;
  totals: ReportTotalsInput;
  unstable: ReportAggregateUnstableStatusInput[];
}

interface ReportAggregateUnstableBuckets {
  test_id: string;
  shard_ids: string[];
  statuses: string[];
}

interface ReportAggregateOutput {
  shard_count: number;
  unstable_count: number;
  totals: ReportTotalsInput;
  unstable: ReportAggregateUnstableBuckets[];
}

interface ReportFileTotalsOutput {
  suite: string;
  totals: ReportTotalsInput;
}

interface ReportSummaryOutput {
  totals: ReportTotalsInput;
  file_totals: ReportFileTotalsOutput[];
  unstable_test_ids: string[];
}

interface ReportDiffCoreExports {
  summarize_report_json: (testsJson: string) => string;
  classify_report_diff_json: (inputsJson: string) => string;
  aggregate_report_json: (shardsJson: string) => string;
}

function toCoreTotals(totals: ReportTotals): ReportTotalsInput {
  return {
    total: totals.total,
    passed: totals.passed,
    failed: totals.failed,
    flaky: totals.flaky,
    skipped: totals.skipped,
    retries: totals.retries,
    duration_ms: totals.durationMs,
  };
}

function fromCoreTotals(totals: ReportTotalsInput): ReportTotals {
  return {
    total: totals.total,
    passed: totals.passed,
    failed: totals.failed,
    flaky: totals.flaky,
    skipped: totals.skipped,
    retries: totals.retries,
    durationMs: totals.duration_ms,
  };
}

const reportBridge = await (async (): Promise<ReportDiffCoreExports> => {
  const mod = (await import(MOONBIT_JS_BRIDGE_URL.href)) as Partial<ReportDiffCoreExports>;
  if (
    typeof mod.summarize_report_json === "function" &&
    typeof mod.classify_report_diff_json === "function" &&
    typeof mod.aggregate_report_json === "function"
  ) {
    return mod as ReportDiffCoreExports;
  }
  throw new Error("MoonBit report bridge is missing. Run 'moon build --target js' first.");
})();

const classifyReportDiff = (inputs: ReportDiffStatusInput[]): ReportDiffBuckets =>
  JSON.parse(reportBridge.classify_report_diff_json(JSON.stringify(inputs)));

const summarizeReport = (tests: ReportSummaryTestInput[]): ReportSummaryOutput =>
  JSON.parse(reportBridge.summarize_report_json(JSON.stringify(tests)));

const aggregateReport = (shards: ReportAggregateShardInput[]): ReportAggregateOutput =>
  JSON.parse(reportBridge.aggregate_report_json(JSON.stringify(shards)));

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

function emptyArtifactMetadata(): ReportSummaryArtifactMetadata {
  return {
    shard: null,
    module: null,
    offset: null,
    limit: null,
    matrix: null,
    variant: null,
    extra: {},
  };
}

function compareNullable(a: string | null, b: string | null): number {
  return (a ?? "").localeCompare(b ?? "");
}

function normalizeRecord(
  input?: Record<string, unknown> | null,
): Record<string, string> | null {
  if (!input) return null;
  const entries = Object.entries(input)
    .filter(([, value]) => value != null)
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return null;
  return Object.fromEntries(entries);
}

function normalizeArtifactMetadata(
  metadata?: Partial<ReportSummaryArtifactMetadata> | null,
): ReportSummaryArtifactMetadata {
  const base = emptyArtifactMetadata();
  if (!metadata) return base;

  return {
    shard: metadata.shard ?? null,
    module: metadata.module ?? null,
    offset: metadata.offset ?? null,
    limit: metadata.limit ?? null,
    matrix: normalizeRecord(metadata.matrix) ?? null,
    variant: normalizeRecord(metadata.variant) ?? null,
    extra: normalizeRecord(metadata.extra) ?? {},
  };
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
  const reduced = summarizeReport(
    tests.map((test) => ({
      test_id: test.testId,
      suite: test.suite,
      status: test.status,
      duration_ms: test.durationMs,
      retry_count: test.retryCount,
    })),
  );
  const unstableIds = new Set(reduced.unstable_test_ids);

  return {
    adapter,
    totals: fromCoreTotals(reduced.totals),
    files: reduced.file_totals.map((entry) => ({
      suite: entry.suite,
      totals: fromCoreTotals(entry.totals),
    })),
    unstable: tests.filter((test) => unstableIds.has(test.testId)),
    tests,
  };
}

export function createReportSummaryArtifact(
  summary: NormalizedReportSummary,
  metadata?: Partial<ReportSummaryArtifactMetadata> | null,
): ReportSummaryArtifact {
  return {
    summary,
    metadata: normalizeArtifactMetadata(metadata),
  };
}

function parseAdapterReport(
  adapter: string,
  input: string,
): TestCaseResult[] {
  return createTestResultAdapter(adapter).parse(input);
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

export function parseReportSummaryArtifact(input: string): ReportSummaryArtifact {
  const parsed = JSON.parse(input) as
    | ReportSummaryArtifact
    | NormalizedReportSummary;

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "summary" in parsed &&
    "metadata" in parsed
  ) {
    const artifact = parsed as ReportSummaryArtifact;
    return createReportSummaryArtifact(artifact.summary, artifact.metadata);
  }

  return createReportSummaryArtifact(parsed as NormalizedReportSummary);
}

export function loadReportSummaryArtifactsFromDir(
  dir: string,
): ReportSummaryArtifact[] {
  const files = walkJsonFiles(dir).sort((a, b) => a.localeCompare(b));
  const artifacts: ReportSummaryArtifact[] = [];

  for (const file of files) {
    try {
      artifacts.push(parseReportSummaryArtifact(readFileSync(file, "utf-8")));
    } catch {
      // Skip non-summary JSON files.
    }
  }

  return artifacts;
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
  const allIds = [...new Set<string>([
    ...baseById.keys(),
    ...headById.keys(),
  ])].sort((a, b) => a.localeCompare(b));

  const buckets = classifyReportDiff(
    allIds.map((testId) => {
      const base = baseById.get(testId);
      const head = headById.get(testId);
      return {
        test_id: testId,
        base_status: base?.status ?? "",
        head_status: head?.status ?? "",
      };
    }),
  );

  const newFailures = buckets.new_failures.map((testId) =>
    toDiffEntry(baseById.get(testId) ?? null, headById.get(testId) ?? null),
  );
  const newFlaky = buckets.new_flaky.map((testId) =>
    toDiffEntry(baseById.get(testId) ?? null, headById.get(testId) ?? null),
  );
  const resolvedFailures = buckets.resolved_failures.map((testId) =>
    toDiffEntry(baseById.get(testId) ?? null, headById.get(testId) ?? null),
  );
  const resolvedFlaky = buckets.resolved_flaky.map((testId) =>
    toDiffEntry(baseById.get(testId) ?? null, headById.get(testId) ?? null),
  );
  const persistentFlaky = buckets.persistent_flaky.map((testId) =>
    toDiffEntry(baseById.get(testId) ?? null, headById.get(testId) ?? null),
  );

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

export function runReportAggregate(opts: {
  summaries: ReportSummaryArtifact[];
}): ReportAggregate {
  const shards = opts.summaries.map((artifact, index) => {
    const shardId = artifact.metadata.shard ?? `summary-${index + 1}`;
    return {
      shardId,
      adapter: artifact.summary.adapter,
      metadata: artifact.metadata,
      totals: artifact.summary.totals,
      unstableCount: artifact.summary.unstable.length,
      summary: artifact.summary,
    };
  });

  const unstableSeedById = new Map<string, ReportTestSummary>();

  for (const shard of shards) {
    for (const test of shard.summary.unstable) {
      if (!unstableSeedById.has(test.testId)) {
        unstableSeedById.set(test.testId, test);
      }
    }
  }

  const aggregate = aggregateReport(
    shards.map((shard) => ({
      shard_id: shard.shardId,
      totals: toCoreTotals(shard.totals),
      unstable: shard.summary.unstable.map((test) => ({
        test_id: test.testId,
        status: test.status === "failed" ? "failed" : "flaky",
      })),
    })),
  );

  return {
    summary: {
      shardCount: aggregate.shard_count,
      unstableCount: aggregate.unstable_count,
    },
    totals: fromCoreTotals(aggregate.totals),
    shards: shards
      .map(({ summary: _summary, ...shard }) => shard)
      .sort((a, b) => a.shardId.localeCompare(b.shardId)),
    unstable: sortTests(
      aggregate.unstable.map((entry) => {
        const seed = unstableSeedById.get(entry.test_id);
        if (!seed) {
          throw new Error(`Missing unstable seed for ${entry.test_id}`);
        }
        return {
          ...seed,
          shards: [...entry.shard_ids].sort(),
          statuses: entry.statuses.filter(
            (status): status is "failed" | "flaky" =>
              status === "failed" || status === "flaky",
          ),
        };
      }),
    ),
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

function addTotals(target: ReportTotals, source: ReportTotals): void {
  target.total += source.total;
  target.passed += source.passed;
  target.failed += source.failed;
  target.flaky += source.flaky;
  target.skipped += source.skipped;
  target.retries += source.retries;
  target.durationMs += source.durationMs;
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

function formatAggregateUnstableRows(
  entries: ReportAggregateUnstableTest[],
): string[] {
  return entries.map(
    (entry) =>
      `| ${entry.suite} | ${entry.testName} | ${entry.taskId} | ${entry.filter ?? "-"} | ${entry.statuses.join(", ")} | ${entry.shards.join(", ")} |`,
  );
}

function formatArtifactMetadataValue(
  metadata: ReportSummaryArtifactMetadata,
): string {
  const parts: string[] = [];

  if (metadata.matrix) {
    parts.push(
      `matrix:${Object.entries(metadata.matrix)
        .map(([key, value]) => `${key}=${value}`)
        .join(",")}`,
    );
  }

  if (metadata.variant) {
    parts.push(
      `variant:${Object.entries(metadata.variant)
        .map(([key, value]) => `${key}=${value}`)
        .join(",")}`,
    );
  }

  const extraEntries = Object.entries(metadata.extra);
  if (extraEntries.length > 0) {
    parts.push(
      `meta:${extraEntries.map(([key, value]) => `${key}=${value}`).join(",")}`,
    );
  }

  return parts.join(" / ") || "-";
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

export function formatReportAggregate(
  aggregate: ReportAggregate,
  format: "json" | "markdown",
): string {
  if (format === "json") {
    return JSON.stringify(aggregate, null, 2);
  }

  const shardRows = aggregate.shards.map(
    (shard) =>
      `| ${shard.shardId} | ${shard.adapter} | ${shard.metadata.module ?? "-"} | ${shard.metadata.offset ?? "-"} | ${shard.metadata.limit ?? "-"} | ${formatArtifactMetadataValue(shard.metadata)} | ${shard.totals.total} | ${shard.totals.failed} | ${shard.totals.flaky} | ${shard.unstableCount} |`,
  );

  return [
    "# Aggregated Test Report",
    "",
    `- Shards: ${aggregate.summary.shardCount}`,
    `- Unstable tests: ${aggregate.summary.unstableCount}`,
    ...formatTotals(aggregate.totals),
    "",
    "## Shards",
    "",
    "| shard | adapter | module | offset | limit | metadata | total | failed | flaky | unstable |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...shardRows,
    "",
    ...formatReportSection(
      "Aggregated Unstable Tests",
      aggregate.unstable.length > 0
        ? [
            "| suite | testName | taskId | filter | statuses | shards |",
            "| --- | --- | --- | --- | --- | --- |",
            ...formatAggregateUnstableRows(aggregate.unstable),
          ]
        : [],
    ),
  ].join("\n");
}

export function formatPrComment(
  summary: NormalizedReportSummary,
): string {
  const lines: string[] = [
    "## flaker: Test Report",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Total | ${summary.totals.total} |`,
    `| Passed | ${summary.totals.passed} |`,
    `| Failed | ${summary.totals.failed} |`,
    `| Flaky | ${summary.totals.flaky} |`,
    `| Skipped | ${summary.totals.skipped} |`,
    `| Duration | ${(summary.totals.durationMs / 1000).toFixed(1)}s |`,
  ];

  const failures = summary.unstable.filter((t) => t.status === "failed");
  if (failures.length > 0) {
    lines.push("", "### Failures", "");
    lines.push("| Test | Suite |");
    lines.push("| --- | --- |");
    for (const t of failures) {
      lines.push(`| ${t.testName} | ${t.suite} |`);
    }
  }

  const flaky = summary.unstable.filter((t) => t.status === "flaky");
  if (flaky.length > 0) {
    lines.push("", "### Flaky", "");
    lines.push("| Test | Suite | Retries |");
    lines.push("| --- | --- | --- |");
    for (const t of flaky) {
      lines.push(`| ${t.testName} | ${t.suite} | ${t.retryCount} |`);
    }
  }

  lines.push("", "---", `*Generated by [flaker](https://github.com/mizchi/flaker)*`);
  return lines.join("\n");
}

function walkJsonFiles(dir: string): string[] {
  const results: string[] = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...walkJsonFiles(fullPath));
      continue;
    }

    if (entry.endsWith(".json")) {
      results.push(fullPath);
    }
  }

  return results;
}
