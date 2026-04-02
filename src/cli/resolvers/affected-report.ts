import type {
  AffectedReport,
  AffectedSelection,
  AffectedTarget,
} from "./types.js";

function compareNullable(a: string | null, b: string | null): number {
  return (a ?? "").localeCompare(b ?? "");
}

export function sortAffectedSelections(
  entries: AffectedSelection[],
): AffectedSelection[] {
  return [...entries].sort((a, b) => {
    const bySpec = a.spec.localeCompare(b.spec);
    if (bySpec !== 0) return bySpec;
    const byTaskId = a.taskId.localeCompare(b.taskId);
    if (byTaskId !== 0) return byTaskId;
    return compareNullable(a.filter, b.filter);
  });
}

export function createAffectedSelection(
  target: AffectedTarget,
  opts: {
    direct: boolean;
    includedBy?: string[];
    matchedPaths?: string[];
    matchReasons?: string[];
  },
): AffectedSelection {
  return {
    taskId: target.taskId,
    spec: target.spec,
    filter: target.filter,
    direct: opts.direct,
    includedBy: [...(opts.includedBy ?? [])].sort(),
    matchedPaths: [...(opts.matchedPaths ?? [])].sort(),
    matchReasons: [...(opts.matchReasons ?? [])],
  };
}

export function buildAffectedReport(
  resolver: string,
  changedFiles: string[],
  selected: AffectedSelection[],
  unmatched: string[],
): AffectedReport {
  const sortedSelected = sortAffectedSelections(selected);
  const matched = sortedSelected.filter((entry) => entry.direct);
  const sortedUnmatched = [...unmatched].sort();
  return {
    resolver,
    changedFiles: [...changedFiles],
    matched,
    selected: sortedSelected,
    unmatched: sortedUnmatched,
    summary: {
      matchedCount: matched.length,
      selectedCount: sortedSelected.length,
      unmatchedCount: sortedUnmatched.length,
    },
  };
}

export function dedupeAffectedTargets(
  targets: AffectedTarget[],
): AffectedTarget[] {
  const byKey = new Map<string, AffectedTarget>();
  for (const target of targets) {
    const key = JSON.stringify({
      spec: target.spec,
      taskId: target.taskId,
      filter: target.filter ?? null,
    });
    if (!byKey.has(key)) {
      byKey.set(key, {
        spec: target.spec,
        taskId: target.taskId,
        filter: target.filter ?? null,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const bySpec = a.spec.localeCompare(b.spec);
    if (bySpec !== 0) return bySpec;
    const byTaskId = a.taskId.localeCompare(b.taskId);
    if (byTaskId !== 0) return byTaskId;
    return compareNullable(a.filter, b.filter);
  });
}
