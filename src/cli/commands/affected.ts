import {
  buildAffectedReport,
  createAffectedSelection,
  dedupeAffectedTargets,
} from "../resolvers/affected-report.js";
import type {
  AffectedReport,
  AffectedSelection,
  DependencyResolver,
} from "../resolvers/types.js";
import type { TestId } from "../runners/types.js";

export interface RunAffectedOpts {
  resolverName: string;
  resolver: DependencyResolver;
  changedFiles: string[];
  listedTests: TestId[];
}

function toAffectedTarget(test: TestId) {
  return {
    spec: test.suite,
    taskId: test.taskId ?? test.suite,
    filter: test.filter ?? null,
  };
}

function normalizeAffectedReport(
  report: AffectedReport,
  resolverName: string,
): AffectedReport {
  return {
    ...report,
    resolver: resolverName,
  };
}

function formatSelectionRow(entry: AffectedSelection): string {
  const filter = entry.filter ?? "-";
  const includedBy = entry.includedBy.length > 0 ? entry.includedBy.join(", ") : "-";
  const reasons = entry.matchReasons.length > 0 ? entry.matchReasons.join(", ") : "-";
  const matchedPaths = entry.matchedPaths.length > 0 ? entry.matchedPaths.join(", ") : "-";
  return `| ${entry.taskId} | ${entry.spec} | ${filter} | ${entry.direct ? "direct" : "transitive"} | ${includedBy} | ${reasons} | ${matchedPaths} |`;
}

function formatSelectionSection(
  title: string,
  entries: AffectedSelection[],
): string[] {
  const lines = [`## ${title}`, ""];
  if (entries.length === 0) {
    lines.push("_None_", "");
    return lines;
  }

  lines.push(
    "| taskId | spec | filter | directness | includedBy | matchReasons | matchedPaths |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...entries.map(formatSelectionRow),
    "",
  );
  return lines;
}

export async function runAffected(opts: RunAffectedOpts): Promise<AffectedReport> {
  const targets = dedupeAffectedTargets(opts.listedTests.map(toAffectedTarget));
  if (opts.resolver.explain) {
    const report = await opts.resolver.explain(opts.changedFiles, targets);
    return normalizeAffectedReport(report, opts.resolverName);
  }

  const affectedSpecs = await opts.resolver.resolve(
    opts.changedFiles,
    targets.map((target) => target.spec),
  );
  const affectedSpecSet = new Set(affectedSpecs);
  const selected = targets
    .filter((target) => affectedSpecSet.has(target.spec))
    .map((target) => createAffectedSelection(target, { direct: true }));

  return buildAffectedReport(opts.resolverName, opts.changedFiles, selected, []);
}

export function formatAffectedReport(
  report: AffectedReport,
  format: "json" | "markdown",
): string {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }

  const lines = [
    "# Affected Report",
    "",
    `- Resolver: ${report.resolver}`,
    `- Changed files: ${report.changedFiles.length}`,
    `- Matched: ${report.summary.matchedCount}`,
    `- Selected: ${report.summary.selectedCount}`,
    `- Unmatched: ${report.summary.unmatchedCount}`,
    "",
    ...formatSelectionSection("Matched", report.matched),
    ...formatSelectionSection("Selected", report.selected),
    "## Unmatched",
    "",
  ];

  if (report.unmatched.length === 0) {
    lines.push("_None_");
  } else {
    lines.push(...report.unmatched.map((path) => `- ${path}`));
  }

  return lines.join("\n");
}
