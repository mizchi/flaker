import type { FlakerIssue } from "./flaker-issue-contract.js";
import { MOONBIT_JS_BRIDGE_URL } from "../core/build-artifact.js";
import type {
  FlakerQuarantineConfig,
  FlakerQuarantineExpiryStatus,
  FlakerQuarantineMode,
  FlakerQuarantineScope,
  FlakerQuarantineSummary,
  FlakerResolvedQuarantineEntry,
} from "./flaker-quarantine-contract.js";
import {
  classifyQuarantineExpiry,
  normalizeToUtcMidnight,
  parseDateOnly,
} from "./flaker-quarantine-expiry.js";
import { compileTitlePattern } from "./flaker-quarantine-match.js";

const DEFAULT_EXPIRES_SOON_DAYS = 7;

export interface FlakerQuarantineTaskOwnership {
  id: string;
  specs: string[];
}

export interface BuildFlakerQuarantineSummaryInputs {
  quarantine: FlakerQuarantineConfig;
  tasks: FlakerQuarantineTaskOwnership[];
  existingSpecs: Set<string>;
  now?: Date;
  expiresSoonDays?: number;
}

interface QuarantineEntryInput {
  id: string;
  task_id: string;
  spec: string;
  title_pattern: string;
  mode: FlakerQuarantineMode;
  scope: FlakerQuarantineScope;
  owner: string;
  reason: string;
  condition: string;
  introduced_at: string;
  expires_at: string;
  tracking_issue?: string;
}

interface QuarantineIssueOutput {
  severity: FlakerIssue["severity"];
  code: string;
  message: string;
  task_id: string | null;
  spec: string | null;
}

interface QuarantineModeCountsOutput {
  skip: number;
  allow_flaky: number;
  allow_failure: number;
}

interface QuarantineScopeCountsOutput {
  environment: number;
  flaky: number;
  expected_failure: number;
}

interface ResolvedQuarantineEntryOutput extends QuarantineEntryInput {
  expiry_status: FlakerQuarantineExpiryStatus;
  days_until_expiry: number | null;
}

interface QuarantineSummaryCoreOutput {
  entry_count: number;
  mode_counts: QuarantineModeCountsOutput;
  scope_counts: QuarantineScopeCountsOutput;
  entries: ResolvedQuarantineEntryOutput[];
  errors: QuarantineIssueOutput[];
  warnings: QuarantineIssueOutput[];
}

interface QuarantineCoreExports {
  summarize_quarantine_json?: (
    entriesJson: string,
    tasksJson: string,
    existingSpecsJson: string,
    nowDate: string,
    expiresSoonDays: number,
  ) => string;
}

function createIssue(issue: FlakerIssue): FlakerIssue {
  return issue;
}

function buildModeCounts(): Record<FlakerQuarantineMode, number> {
  return {
    skip: 0,
    allow_flaky: 0,
    allow_failure: 0,
  };
}

function buildScopeCounts(): Record<FlakerQuarantineScope, number> {
  return {
    environment: 0,
    flaky: 0,
    expected_failure: 0,
  };
}

function buildFlakerQuarantineSummaryFallback(
  inputs: BuildFlakerQuarantineSummaryInputs,
): FlakerQuarantineSummary {
  const now = normalizeToUtcMidnight(inputs.now ?? new Date());
  const expiresSoonDays = inputs.expiresSoonDays ?? DEFAULT_EXPIRES_SOON_DAYS;
  const taskById = new Map(inputs.tasks.map((task) => [task.id, task]));
  const errors: FlakerIssue[] = [];
  const warnings: FlakerIssue[] = [];
  const seenIds = new Set<string>();
  const entries: FlakerResolvedQuarantineEntry[] = [];
  const modeCounts = buildModeCounts();
  const scopeCounts = buildScopeCounts();

  for (const entry of inputs.quarantine.entries) {
    modeCounts[entry.mode] += 1;
    scopeCounts[entry.scope] += 1;

    if (seenIds.has(entry.id)) {
      errors.push(createIssue({
        severity: "error",
        code: "duplicate-quarantine-id",
        message: `Duplicate quarantine id: ${entry.id}`,
        taskId: entry.taskId,
        spec: entry.spec,
      }));
    } else {
      seenIds.add(entry.id);
    }

    const task = taskById.get(entry.taskId);
    if (!task) {
      errors.push(createIssue({
        severity: "error",
        code: "unknown-task",
        message: `Quarantine entry references unknown task: ${entry.taskId}`,
        taskId: entry.taskId,
        spec: entry.spec,
      }));
    }

    if (!inputs.existingSpecs.has(entry.spec)) {
      errors.push(createIssue({
        severity: "error",
        code: "missing-spec",
        message: `Quarantine entry references missing spec: ${entry.spec}`,
        taskId: entry.taskId,
        spec: entry.spec,
      }));
    } else if (task && !task.specs.includes(entry.spec)) {
      errors.push(createIssue({
        severity: "error",
        code: "task-does-not-own-spec",
        message: `Task ${entry.taskId} does not own spec ${entry.spec}`,
        taskId: entry.taskId,
        spec: entry.spec,
      }));
    }

    if (!compileTitlePattern(entry.titlePattern)) {
      errors.push(createIssue({
        severity: "error",
        code: "invalid-title-pattern",
        message: `Invalid title pattern for quarantine ${entry.id}: ${entry.titlePattern}`,
        taskId: entry.taskId,
        spec: entry.spec,
      }));
    }

    const introducedAt = parseDateOnly(entry.introducedAt);
    if (!introducedAt) {
      errors.push(createIssue({
        severity: "error",
        code: "invalid-introduced-at",
        message: `Invalid introducedAt for quarantine ${entry.id}: ${entry.introducedAt}`,
        taskId: entry.taskId,
        spec: entry.spec,
      }));
    }

    const expiresAt = parseDateOnly(entry.expiresAt);
    if (!expiresAt) {
      errors.push(createIssue({
        severity: "error",
        code: "invalid-expires-at",
        message: `Invalid expiresAt for quarantine ${entry.id}: ${entry.expiresAt}`,
        taskId: entry.taskId,
        spec: entry.spec,
      }));
    }

    if (introducedAt && expiresAt && introducedAt.getTime() > expiresAt.getTime()) {
      errors.push(createIssue({
        severity: "error",
        code: "invalid-expiry-range",
        message: `introducedAt must be on or before expiresAt for quarantine ${entry.id}`,
        taskId: entry.taskId,
        spec: entry.spec,
      }));
    }

    const expiry = classifyQuarantineExpiry(now, expiresAt, expiresSoonDays);
    const expiryStatus: FlakerQuarantineExpiryStatus = expiry.status;
    const daysUntilExpiry = expiry.daysUntilExpiry;

    if (expiryStatus === "expired") {
      errors.push(createIssue({
        severity: "error",
        code: "expired-quarantine",
        message: `Quarantine ${entry.id} expired on ${entry.expiresAt}`,
        taskId: entry.taskId,
        spec: entry.spec,
      }));
    } else if (expiryStatus === "expires-soon") {
      warnings.push(createIssue({
        severity: "warning",
        code: "expires-soon",
        message: `Quarantine ${entry.id} expires on ${entry.expiresAt}`,
        taskId: entry.taskId,
        spec: entry.spec,
      }));
    }

    entries.push({
      ...entry,
      expiryStatus,
      daysUntilExpiry,
    });
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    entryCount: inputs.quarantine.entries.length,
    modeCounts,
    scopeCounts,
    entries: entries.sort((a, b) => a.id.localeCompare(b.id)),
    errors,
    warnings,
  };
}

function mapEntryToCore(
  entry: FlakerQuarantineConfig["entries"][number],
): QuarantineEntryInput {
  return {
    id: entry.id,
    task_id: entry.taskId,
    spec: entry.spec,
    title_pattern: entry.titlePattern,
    mode: entry.mode,
    scope: entry.scope,
    owner: entry.owner,
    reason: entry.reason,
    condition: entry.condition,
    introduced_at: entry.introducedAt,
    expires_at: entry.expiresAt,
    ...(entry.trackingIssue ? { tracking_issue: entry.trackingIssue } : {}),
  };
}

function mapIssueFromCore(issue: QuarantineIssueOutput): FlakerIssue {
  return {
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
    ...(issue.task_id ? { taskId: issue.task_id } : {}),
    ...(issue.spec ? { spec: issue.spec } : {}),
  };
}

function mapEntryFromCore(
  entry: ResolvedQuarantineEntryOutput,
): FlakerResolvedQuarantineEntry {
  return {
    id: entry.id,
    taskId: entry.task_id,
    spec: entry.spec,
    titlePattern: entry.title_pattern,
    mode: entry.mode,
    scope: entry.scope,
    owner: entry.owner,
    reason: entry.reason,
    condition: entry.condition,
    introducedAt: entry.introduced_at,
    expiresAt: entry.expires_at,
    ...(entry.tracking_issue ? { trackingIssue: entry.tracking_issue } : {}),
    expiryStatus: entry.expiry_status,
    daysUntilExpiry: entry.days_until_expiry,
  };
}

async function loadQuarantineSummaryBuilder(): Promise<
  (inputs: BuildFlakerQuarantineSummaryInputs) => FlakerQuarantineSummary
> {
  try {
    const mod = (await import(MOONBIT_JS_BRIDGE_URL.href)) as QuarantineCoreExports;
    if (typeof mod.summarize_quarantine_json === "function") {
      return (inputs) => {
        const now = normalizeToUtcMidnight(inputs.now ?? new Date());
        const expiresSoonDays = inputs.expiresSoonDays ?? DEFAULT_EXPIRES_SOON_DAYS;
        const output = JSON.parse(
          mod.summarize_quarantine_json!(
            JSON.stringify(inputs.quarantine.entries.map(mapEntryToCore)),
            JSON.stringify(inputs.tasks),
            JSON.stringify([...inputs.existingSpecs].sort()),
            now.toISOString().slice(0, 10),
            expiresSoonDays,
          ),
        ) as QuarantineSummaryCoreOutput;

        return {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          entryCount: output.entry_count,
          modeCounts: output.mode_counts,
          scopeCounts: output.scope_counts,
          entries: output.entries.map(mapEntryFromCore),
          errors: output.errors.map(mapIssueFromCore),
          warnings: output.warnings.map(mapIssueFromCore),
        };
      };
    }
  } catch {
    // MoonBit JS build not available, fall back to TS implementation.
  }
  return buildFlakerQuarantineSummaryFallback;
}

let cachedQuarantineSummaryBuilder:
  | ((inputs: BuildFlakerQuarantineSummaryInputs) => FlakerQuarantineSummary)
  | undefined;

async function getBuildFlakerQuarantineSummary(): Promise<
  (inputs: BuildFlakerQuarantineSummaryInputs) => FlakerQuarantineSummary
> {
  if (cachedQuarantineSummaryBuilder) return cachedQuarantineSummaryBuilder;
  cachedQuarantineSummaryBuilder = await loadQuarantineSummaryBuilder();
  return cachedQuarantineSummaryBuilder;
}

export async function buildFlakerQuarantineSummary(
  inputs: BuildFlakerQuarantineSummaryInputs,
): Promise<FlakerQuarantineSummary> {
  const impl = await getBuildFlakerQuarantineSummary();
  return impl(inputs);
}
