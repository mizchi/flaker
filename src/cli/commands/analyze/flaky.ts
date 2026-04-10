import type { MetricStore, FlakyScore, FlakyQueryOpts, TrendEntry, TrueFlakyScore, VariantFlakyScore } from "../../storage/types.js";

export interface FlakyOpts {
  store: MetricStore;
  top?: number;
  suite?: string;
  testName?: string;
  windowDays?: number;
}

export async function runFlaky(opts: FlakyOpts): Promise<FlakyScore[]> {
  const queryOpts: FlakyQueryOpts = {
    top: opts.top,
    suite: opts.suite,
    testName: opts.testName,
    windowDays: opts.windowDays,
  };

  let results = await opts.store.queryFlakyTests(queryOpts);

  if (opts.testName) {
    results = results.filter((r) => r.testName === opts.testName);
  }
  if (opts.suite) {
    results = results.filter((r) => r.suite === opts.suite);
  }
  if (opts.top) {
    results = results.slice(0, opts.top);
  }

  return results;
}

export function formatFlakyTable(results: FlakyScore[]): string {
  if (results.length === 0) {
    return "No flaky tests found.";
  }

  const broken = results.filter((r) => r.flakyRate >= 100 && r.totalRuns >= 2);
  const flaky = results.filter((r) => r.flakyRate < 100 || r.totalRuns < 2);

  const lines: string[] = [];
  if (broken.length > 0) {
    lines.push(`Broken (100% fail — not flaky, fix or quarantine):`);
    const headers = ["Suite", "Test Name", "Total Runs", "Fail Count"];
    const rows = broken.map((r) => [
      r.suite,
      r.testName,
      String(r.totalRuns),
      String(r.failCount),
    ]);
    lines.push(formatTable(headers, rows));
    lines.push("");
  }
  if (flaky.length > 0) {
    lines.push(`Flaky (intermittent failures):`);
    const headers = ["Suite", "Test Name", "Flaky Rate", "Total Runs", "Fail Count"];
    const rows = flaky.map((r) => [
      r.suite,
      r.testName,
      `${r.flakyRate}%`,
      String(r.totalRuns),
      String(r.failCount),
    ]);
    lines.push(formatTable(headers, rows));
  }
  if (lines.length === 0) {
    return "No flaky tests found.";
  }
  return lines.join("\n");
}

export async function runFlakyTrend(opts: { store: MetricStore; suite: string; testName: string }): Promise<TrendEntry[]> {
  return opts.store.queryFlakyTrend(opts.suite, opts.testName);
}

export function formatFlakyTrend(entries: TrendEntry[]): string {
  if (entries.length === 0) return "No trend data found.";
  return entries.map((e) => `${e.week}  ${e.flakyRate.toFixed(1)}%  (${e.runs} runs)`).join("\n");
}

export async function runTrueFlaky(opts: { store: MetricStore; top?: number }): Promise<TrueFlakyScore[]> {
  return opts.store.queryTrueFlakyTests({ top: opts.top });
}

export function formatTrueFlakyTable(results: TrueFlakyScore[]): string {
  if (results.length === 0) return "No retry-flaky tests found (pass+fail within same commit).";
  const lines = results.map((r) =>
    `${r.suite} > ${r.testName}  ${r.trueFlakyRate.toFixed(1)}%  (${r.flakyCommits}/${r.commitsTested} commits)`
  );
  return lines.join("\n");
}

export interface FlakyByVariantOpts {
  store: MetricStore;
  suite?: string;
  testName?: string;
  top?: number;
}

export async function runFlakyByVariant(opts: FlakyByVariantOpts): Promise<VariantFlakyScore[]> {
  return opts.store.queryFlakyByVariant({
    suite: opts.suite,
    testName: opts.testName,
    top: opts.top,
  });
}

export function formatFlakyByVariantTable(results: VariantFlakyScore[]): string {
  if (results.length === 0) return "No variant flaky data found.";
  const lines = results.map((r) => {
    const variantStr = Object.entries(r.variant).map(([k, v]) => `${k}=${v}`).join(", ");
    return `${r.suite} > ${r.testName} [${variantStr}]  ${r.flakyRate}%  (${r.failCount}/${r.totalRuns})`;
  });
  return lines.join("\n");
}

function formatTable(headers: string[], rows: string[][]): string {
  const allRows = [headers, ...rows];
  const colWidths = headers.map((_, i) =>
    Math.max(...allRows.map((row) => (row[i] ?? "").length)),
  );

  const sep = colWidths.map((w) => "-".repeat(w)).join(" | ");
  const formatRow = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(colWidths[i])).join(" | ");

  const lines = [formatRow(headers), sep, ...rows.map(formatRow)];
  return lines.join("\n");
}
