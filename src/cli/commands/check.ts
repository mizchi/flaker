import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import type { TestId } from "../runners/types.js";
import { parseBitflowWorkflowTasks } from "../resolvers/bitflow-workflow.js";

export interface TaskDefinition {
  taskId: string;
  node: string | null;
  needs: string[];
  srcs: string[];
}

export interface OwnershipClaim {
  taskId: string;
  filter: string | null;
  testCount: number;
}

export interface OwnershipEntry {
  spec: string;
  kind: "owned" | "split" | "duplicate";
  owners: OwnershipClaim[];
}

export interface ConfigCheckIssue {
  code: "duplicate-ownership" | "unmanaged-spec";
  spec: string;
  detail: string;
}

export interface TaskSummary {
  taskId: string;
  node: string | null;
  specCount: number;
  testCount: number;
  filterCount: number;
  needsCount: number;
  srcCount: number;
}

export interface ConfigCheckReport {
  summary: {
    taskCount: number;
    specCount: number;
    duplicateOwnershipCount: number;
    splitOwnershipCount: number;
    unmanagedSpecCount: number;
    errorCount: number;
    warningCount: number;
  };
  ownership: OwnershipEntry[];
  tasks: TaskSummary[];
  errors: ConfigCheckIssue[];
  warnings: ConfigCheckIssue[];
}

export interface RunConfigCheckOpts {
  listedTests: TestId[];
  discoveredSpecs: string[];
  taskDefinitions?: TaskDefinition[];
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function compareNullable(a: string | null, b: string | null): number {
  return (a ?? "").localeCompare(b ?? "");
}

function sortClaims(claims: OwnershipClaim[]): OwnershipClaim[] {
  return [...claims].sort((a, b) => {
    const byTaskId = a.taskId.localeCompare(b.taskId);
    if (byTaskId !== 0) return byTaskId;
    return compareNullable(a.filter, b.filter);
  });
}

function claimKey(claim: { taskId: string; filter: string | null }): string {
  return `${claim.taskId}\0${claim.filter ?? ""}`;
}

function classifyOwnership(claims: OwnershipClaim[]): OwnershipEntry["kind"] {
  if (claims.length <= 1) return "owned";

  const filters = new Set<string>();
  for (const claim of claims) {
    if (claim.filter == null) {
      return "duplicate";
    }

    if (filters.has(claim.filter)) {
      return "duplicate";
    }
    filters.add(claim.filter);
  }

  return "split";
}

export function runConfigCheck(opts: RunConfigCheckOpts): ConfigCheckReport {
  const ownershipIndex = new Map<string, Map<string, OwnershipClaim>>();
  const taskSpecs = new Map<string, Set<string>>();
  const taskFilters = new Map<string, Set<string>>();
  const taskTestCounts = new Map<string, number>();
  const taskDefinitions = new Map(
    (opts.taskDefinitions ?? []).map((task) => [task.taskId, task]),
  );

  for (const test of opts.listedTests) {
    const spec = normalizePath(test.suite);
    const taskId = test.taskId ?? spec;
    const filter = test.filter ?? null;

    let claimsByKey = ownershipIndex.get(spec);
    if (!claimsByKey) {
      claimsByKey = new Map<string, OwnershipClaim>();
      ownershipIndex.set(spec, claimsByKey);
    }

    const key = claimKey({ taskId, filter });
    const existingClaim = claimsByKey.get(key);
    if (existingClaim) {
      existingClaim.testCount += 1;
    } else {
      claimsByKey.set(key, {
        taskId,
        filter,
        testCount: 1,
      });
    }

    let specs = taskSpecs.get(taskId);
    if (!specs) {
      specs = new Set<string>();
      taskSpecs.set(taskId, specs);
    }
    specs.add(spec);

    let filters = taskFilters.get(taskId);
    if (!filters) {
      filters = new Set<string>();
      taskFilters.set(taskId, filters);
    }
    if (filter != null) {
      filters.add(filter);
    }

    taskTestCounts.set(taskId, (taskTestCounts.get(taskId) ?? 0) + 1);
  }

  const ownership = [...ownershipIndex.entries()]
    .map(([spec, claimsByKey]) => {
      const owners = sortClaims([...claimsByKey.values()]);
      return {
        spec,
        kind: classifyOwnership(owners),
        owners,
      } satisfies OwnershipEntry;
    })
    .sort((a, b) => a.spec.localeCompare(b.spec));

  const errors = ownership
    .filter((entry) => entry.kind === "duplicate")
    .map((entry) => ({
      code: "duplicate-ownership",
      spec: entry.spec,
      detail: entry.owners
        .map((owner) => `${owner.taskId}${owner.filter ? ` (${owner.filter})` : ""}`)
        .join(", "),
    }) satisfies ConfigCheckIssue);

  const managedSpecs = new Set(ownership.map((entry) => entry.spec));
  const warnings = [...new Set(opts.discoveredSpecs.map(normalizePath))]
    .filter((spec) => !managedSpecs.has(spec))
    .sort((a, b) => a.localeCompare(b))
    .map((spec) => ({
      code: "unmanaged-spec",
      spec,
      detail: "Spec exists on disk but is not claimed by any task",
    }) satisfies ConfigCheckIssue);

  const taskIds = new Set<string>([
    ...taskTestCounts.keys(),
    ...taskDefinitions.keys(),
  ]);
  const tasks = [...taskIds]
    .map((taskId) => {
      const definition = taskDefinitions.get(taskId);
      return {
        taskId,
        node: definition?.node ?? null,
        specCount: taskSpecs.get(taskId)?.size ?? 0,
        testCount: taskTestCounts.get(taskId) ?? 0,
        filterCount: taskFilters.get(taskId)?.size ?? 0,
        needsCount: definition?.needs.length ?? 0,
        srcCount: definition?.srcs.length ?? 0,
      } satisfies TaskSummary;
    })
    .sort((a, b) => a.taskId.localeCompare(b.taskId));

  return {
    summary: {
      taskCount: tasks.length,
      specCount: ownership.length,
      duplicateOwnershipCount: errors.length,
      splitOwnershipCount: ownership.filter((entry) => entry.kind === "split")
        .length,
      unmanagedSpecCount: warnings.length,
      errorCount: errors.length,
      warningCount: warnings.length,
    },
    ownership,
    tasks,
    errors,
    warnings,
  };
}

function formatSummaryList(report: ConfigCheckReport): string[] {
  return [
    `- Tasks: ${report.summary.taskCount}`,
    `- Managed specs: ${report.summary.specCount}`,
    `- Duplicate ownership: ${report.summary.duplicateOwnershipCount}`,
    `- Split ownership: ${report.summary.splitOwnershipCount}`,
    `- Unmanaged specs: ${report.summary.unmanagedSpecCount}`,
    `- Errors: ${report.summary.errorCount}`,
    `- Warnings: ${report.summary.warningCount}`,
  ];
}

function formatIssues(
  title: string,
  issues: ConfigCheckIssue[],
): string[] {
  const lines = [`## ${title}`, ""];
  if (issues.length === 0) {
    lines.push("_None_", "");
    return lines;
  }

  for (const issue of issues) {
    lines.push(`- ${issue.spec}: ${issue.detail}`);
  }
  lines.push("");
  return lines;
}

function formatOwnershipTable(entries: OwnershipEntry[]): string[] {
  const lines = ["## Ownership", ""];
  if (entries.length === 0) {
    lines.push("_None_", "");
    return lines;
  }

  lines.push(
    "| spec | kind | owners |",
    "| --- | --- | --- |",
  );
  for (const entry of entries) {
    const owners = entry.owners
      .map((owner) => `${owner.taskId}${owner.filter ? ` (${owner.filter})` : ""}`)
      .join(", ");
    lines.push(`| ${entry.spec} | ${entry.kind} | ${owners} |`);
  }
  lines.push("");
  return lines;
}

function formatTaskTable(tasks: TaskSummary[]): string[] {
  const lines = ["## Tasks", ""];
  if (tasks.length === 0) {
    lines.push("_None_", "");
    return lines;
  }

  lines.push(
    "| taskId | node | specs | tests | filters | needs | srcs |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const task of tasks) {
    lines.push(
      `| ${task.taskId} | ${task.node ?? "-"} | ${task.specCount} | ${task.testCount} | ${task.filterCount} | ${task.needsCount} | ${task.srcCount} |`,
    );
  }
  lines.push("");
  return lines;
}

export function formatConfigCheckReport(
  report: ConfigCheckReport,
  format: "json" | "markdown",
): string {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }

  return [
    "# Config Check Report",
    "",
    ...formatSummaryList(report),
    "",
    ...formatIssues("Errors", report.errors),
    ...formatIssues("Warnings", report.warnings),
    ...formatOwnershipTable(report.ownership),
    ...formatTaskTable(report.tasks),
  ].join("\n");
}

export function discoverTestSpecsForCheck(
  cwd: string,
  runnerType: string,
): string[] {
  const results: string[] = [];
  walkSpecs(cwd, cwd, runnerType, results);
  return [...new Set(results)].sort((a, b) => a.localeCompare(b));
}

function walkSpecs(
  rootDir: string,
  currentDir: string,
  runnerType: string,
  out: string[],
): void {
  for (const entry of readdirSync(currentDir)) {
    if (
      entry === "node_modules" ||
      entry === ".git" ||
      entry === ".flaker" ||
      entry === "_build" ||
      entry === "target" ||
      entry === ".mooncakes"
    ) {
      continue;
    }

    const fullPath = join(currentDir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walkSpecs(rootDir, fullPath, runnerType, out);
      continue;
    }

    if (!isRecognizedSpec(entry, runnerType)) {
      continue;
    }

    out.push(normalizePath(relative(rootDir, fullPath)));
  }
}

function isRecognizedSpec(fileName: string, runnerType: string): boolean {
  if (runnerType === "moontest") {
    return fileName.endsWith("_test.mbt");
  }

  return /\.(spec|test)\.(ts|tsx|js|jsx|mts|mjs|cts|cjs)$/.test(fileName);
}

export function loadTaskDefinitionsForCheck(opts: {
  cwd: string;
  resolverName: string;
  resolverConfig?: string;
}): TaskDefinition[] {
  if (opts.resolverName !== "bitflow" || !opts.resolverConfig) {
    return [];
  }

  const configPath = isAbsolute(opts.resolverConfig)
    ? opts.resolverConfig
    : join(opts.cwd, opts.resolverConfig);
  if (!existsSync(configPath)) {
    return [];
  }

  return parseBitflowWorkflowTasks(readFileSync(configPath, "utf-8")).map(
    (task) => ({
      taskId: task.id,
      node: task.node,
      needs: [...task.needs],
      srcs: [...task.srcs],
    }),
  );
}
