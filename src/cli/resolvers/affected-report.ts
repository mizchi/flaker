import { MOONBIT_JS_BRIDGE_URL } from "../core/build-artifact.js";
import { importOptionalMoonBitBridge } from "../core/bridge-loader.js";
import type {
  AffectedReport,
  AffectedSelection,
  AffectedTarget,
} from "./types.js";

export interface AffectedDirectSelectionInput {
  target: AffectedTarget;
  matchedPaths?: string[];
  matchReasons?: string[];
}

export interface AffectedTransitiveTaskInput {
  taskId: string;
  includedBy?: string[];
  matchReasons?: string[];
}

interface CoreAffectedTargetInput {
  spec: string;
  task_id: string;
  filter?: string;
}

interface CoreAffectedDirectSelectionInput {
  spec: string;
  task_id: string;
  filter?: string;
  matched_paths: string[];
  match_reasons: string[];
}

interface CoreAffectedTransitiveTaskInput {
  task_id: string;
  included_by: string[];
  match_reasons: string[];
}

interface CoreAffectedSelectionOutput {
  task_id: string;
  spec: string;
  filter?: string;
  direct: boolean;
  included_by: string[];
  matched_paths: string[];
  match_reasons: string[];
}

interface CoreAffectedReportSummaryOutput {
  matched_count: number;
  selected_count: number;
  unmatched_count: number;
}

interface CoreAffectedReportOutput {
  matched: CoreAffectedSelectionOutput[];
  selected: CoreAffectedSelectionOutput[];
  unmatched: string[];
  summary: CoreAffectedReportSummaryOutput;
}

interface AffectedExplainCoreExports {
  dedupe_affected_targets_json: (targetsJson: string) => string;
  build_affected_report_json: (
    targetsJson: string,
    directSelectionsJson: string,
    transitiveTasksJson: string,
    unmatchedJson: string,
  ) => string;
}

function isAffectedExplainCoreExports(
  mod: Partial<AffectedExplainCoreExports>,
): mod is AffectedExplainCoreExports {
  return (
    typeof mod.dedupe_affected_targets_json === "function"
    && typeof mod.build_affected_report_json === "function"
  );
}

function compareNullable(a: string | null, b: string | null): number {
  return (a ?? "").localeCompare(b ?? "");
}

function targetKey(target: AffectedTarget): string {
  return `${target.spec}\n${target.taskId}\n${target.filter ?? ""}`;
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
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

function toCoreTarget(target: AffectedTarget): CoreAffectedTargetInput {
  const base: CoreAffectedTargetInput = {
    spec: target.spec,
    task_id: target.taskId,
  };
  if (target.filter != null) {
    base.filter = target.filter;
  }
  return base;
}

function toCoreDirectSelection(
  input: AffectedDirectSelectionInput,
): CoreAffectedDirectSelectionInput {
  const base: CoreAffectedDirectSelectionInput = {
    spec: input.target.spec,
    task_id: input.target.taskId,
    matched_paths: [...(input.matchedPaths ?? [])],
    match_reasons: [...(input.matchReasons ?? [])],
  };
  if (input.target.filter != null) {
    base.filter = input.target.filter;
  }
  return base;
}

function toCoreTransitiveTask(
  input: AffectedTransitiveTaskInput,
): CoreAffectedTransitiveTaskInput {
  return {
    task_id: input.taskId,
    included_by: [...(input.includedBy ?? [])],
    match_reasons: [...(input.matchReasons ?? [])],
  };
}

function fromCoreSelection(
  selection: CoreAffectedSelectionOutput,
): AffectedSelection {
  return {
    taskId: selection.task_id,
    spec: selection.spec,
    filter: selection.filter ?? null,
    direct: selection.direct,
    includedBy: [...selection.included_by],
    matchedPaths: [...selection.matched_paths],
    matchReasons: [...selection.match_reasons],
  };
}

function fromCoreReport(
  resolver: string,
  changedFiles: string[],
  report: CoreAffectedReportOutput,
): AffectedReport {
  return {
    resolver,
    changedFiles: [...changedFiles],
    matched: report.matched.map(fromCoreSelection),
    selected: report.selected.map(fromCoreSelection),
    unmatched: [...report.unmatched],
    summary: {
      matchedCount: report.summary.matched_count,
      selectedCount: report.summary.selected_count,
      unmatchedCount: report.summary.unmatched_count,
    },
  };
}

function dedupeAffectedTargetsFallback(
  targets: AffectedTarget[],
): AffectedTarget[] {
  const dedupedByKey = new Map<string, AffectedTarget>();
  const deduped: AffectedTarget[] = [];

  for (const target of targets) {
    const key = targetKey(target);
    if (dedupedByKey.has(key)) continue;
    dedupedByKey.set(key, target);
    deduped.push(target);
  }

  return deduped.sort((a, b) => {
    const bySpec = a.spec.localeCompare(b.spec);
    if (bySpec !== 0) return bySpec;
    const byTask = a.taskId.localeCompare(b.taskId);
    if (byTask !== 0) return byTask;
    return compareNullable(a.filter, b.filter);
  });
}

function buildAffectedReportFallback(opts: {
  resolver: string;
  changedFiles: string[];
  targets: AffectedTarget[];
  directSelections: AffectedDirectSelectionInput[];
  transitiveTasks?: AffectedTransitiveTaskInput[];
  unmatched: string[];
}): AffectedReport {
  const sortedTargets = dedupeAffectedTargetsFallback(opts.targets);
  const directByKey = new Map<string, {
    target: AffectedTarget;
    matchedPaths: string[];
    matchReasons: string[];
  }>();

  for (const selection of opts.directSelections) {
    const key = targetKey(selection.target);
    const acc = directByKey.get(key) ?? {
      target: selection.target,
      matchedPaths: [],
      matchReasons: [],
    };
    for (const matchedPath of selection.matchedPaths ?? []) {
      addUnique(acc.matchedPaths, matchedPath);
    }
    for (const matchReason of selection.matchReasons ?? []) {
      addUnique(acc.matchReasons, matchReason);
    }
    directByKey.set(key, acc);
  }

  const transitiveByTask = new Map<string, {
    includedBy: string[];
    matchReasons: string[];
  }>();
  for (const task of opts.transitiveTasks ?? []) {
    const acc = transitiveByTask.get(task.taskId) ?? {
      includedBy: [],
      matchReasons: [],
    };
    for (const parent of task.includedBy ?? []) {
      addUnique(acc.includedBy, parent);
    }
    for (const reason of task.matchReasons ?? []) {
      addUnique(acc.matchReasons, reason);
    }
    transitiveByTask.set(task.taskId, acc);
  }

  const selected: AffectedSelection[] = [];
  const directKeys = new Set<string>();

  for (const target of sortedTargets) {
    const key = targetKey(target);
    const acc = directByKey.get(key);
    if (!acc) continue;
    directKeys.add(key);
    selected.push(createAffectedSelection(target, {
      direct: true,
      matchedPaths: [...acc.matchedPaths].sort(),
      matchReasons: [...acc.matchReasons],
    }));
  }

  for (const target of sortedTargets) {
    const key = targetKey(target);
    if (directKeys.has(key)) continue;
    const acc = transitiveByTask.get(target.taskId);
    if (!acc) continue;
    selected.push(createAffectedSelection(target, {
      direct: false,
      includedBy: [...acc.includedBy].sort(),
      matchReasons: [...acc.matchReasons],
    }));
  }

  return buildAffectedReport(
    opts.resolver,
    opts.changedFiles,
    selected,
    opts.unmatched,
  );
}

let cachedAffectedExplainCore: AffectedExplainCoreExports | null | undefined;

async function getAffectedExplainCore(): Promise<AffectedExplainCoreExports | null> {
  if (cachedAffectedExplainCore !== undefined) return cachedAffectedExplainCore;
  const core = await importOptionalMoonBitBridge<AffectedExplainCoreExports>(
    MOONBIT_JS_BRIDGE_URL,
    isAffectedExplainCoreExports,
  );
  cachedAffectedExplainCore = core ?? null;
  return cachedAffectedExplainCore;
}

export async function dedupeAffectedTargets(
  targets: AffectedTarget[],
): Promise<AffectedTarget[]> {
  const affectedExplainCore = await getAffectedExplainCore();
  if (!affectedExplainCore) {
    return dedupeAffectedTargetsFallback(targets);
  }
  return JSON.parse(
    affectedExplainCore.dedupe_affected_targets_json(
      JSON.stringify(targets.map(toCoreTarget)),
    ),
  ).map((target: CoreAffectedTargetInput) => ({
    spec: target.spec,
    taskId: target.task_id,
    filter: target.filter ?? null,
  }));
}

export async function buildAffectedReportFromInputs(opts: {
  resolver: string;
  changedFiles: string[];
  targets: AffectedTarget[];
  directSelections: AffectedDirectSelectionInput[];
  transitiveTasks?: AffectedTransitiveTaskInput[];
  unmatched: string[];
}): Promise<AffectedReport> {
  const affectedExplainCore = await getAffectedExplainCore();
  if (!affectedExplainCore) {
    return buildAffectedReportFallback(opts);
  }
  const report = JSON.parse(
    affectedExplainCore.build_affected_report_json(
      JSON.stringify(opts.targets.map(toCoreTarget)),
      JSON.stringify(opts.directSelections.map(toCoreDirectSelection)),
      JSON.stringify((opts.transitiveTasks ?? []).map(toCoreTransitiveTask)),
      JSON.stringify(opts.unmatched),
    ),
  ) as CoreAffectedReportOutput;
  return fromCoreReport(opts.resolver, opts.changedFiles, report);
}
