import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { MOONBIT_JS_BRIDGE_URL } from "./core/build-artifact.js";
import { resolveTestIdentity } from "./identity.js";

export type QuarantineMode = "skip" | "allow_flaky" | "allow_failure";
export type QuarantineScope =
  | "environment"
  | "flaky"
  | "expected_failure";

export interface QuarantineManifestEntry {
  id: string;
  taskId: string;
  spec: string;
  titlePattern: string;
  mode: QuarantineMode;
  scope: QuarantineScope;
  owner: string;
  reason: string;
  condition: string;
  introducedAt: string;
  expiresAt: string;
  trackingIssue?: string;
}

export interface QuarantineManifest {
  entries: QuarantineManifestEntry[];
}

export interface QuarantineManifestProblem {
  code: string;
  entryId: string;
  message: string;
}

export interface QuarantineManifestReport {
  manifestPath: string;
  entries: QuarantineManifestEntry[];
  errors: QuarantineManifestProblem[];
  warnings: QuarantineManifestProblem[];
  summary: {
    totalEntries: number;
    errorCount: number;
    warningCount: number;
    expiredCount: number;
    nearExpiryCount: number;
  };
}

export interface QuarantineManifestSelector {
  suite: string;
  testName: string;
  taskId?: string | null;
}

interface FindMatchingManifestEntryOpts {
  modes?: QuarantineMode[];
}

interface LoadQuarantineManifestOpts {
  cwd: string;
  manifestPath?: string;
}

interface ValidateQuarantineManifestOpts {
  cwd: string;
  manifest: QuarantineManifest;
  manifestPath: string;
  knownTaskIds?: string[];
  now?: Date;
  expiringWithinDays?: number;
}

interface QuarantineEntryInput {
  id: string;
  task_id: string;
  spec: string;
  title_pattern: string;
  mode: QuarantineMode;
  scope: QuarantineScope;
  owner: string;
  reason: string;
  condition: string;
  introduced_at: string;
  expires_at: string;
  tracking_issue?: string;
}

interface QuarantineMatchExports {
  find_matching_quarantine_json: (
    entriesJson: string,
    taskId: string,
    spec: string,
    title: string,
  ) => string;
}

const DEFAULT_MANIFEST_FILES = [
  "flaker.quarantine.json",
  "flaker-quarantine.json",
] as const;
const QUARANTINE_MODES = new Set<QuarantineMode>([
  "skip",
  "allow_flaky",
  "allow_failure",
]);
const QUARANTINE_SCOPES = new Set<QuarantineScope>([
  "environment",
  "flaky",
  "expected_failure",
]);

export function resolveQuarantineManifestPath(
  opts: LoadQuarantineManifestOpts,
): string | null {
  if (opts.manifestPath) {
    return resolve(opts.cwd, opts.manifestPath);
  }

  for (const fileName of DEFAULT_MANIFEST_FILES) {
    const candidate = join(opts.cwd, fileName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function parseManifestFile(manifestPath: string): QuarantineManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown parse error";
    throw new Error(
      `Failed to parse quarantine manifest at ${manifestPath}: ${message}`,
    );
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("entries" in parsed) ||
    !Array.isArray((parsed as { entries?: unknown }).entries)
  ) {
    throw new Error(
      `Invalid quarantine manifest at ${manifestPath}: expected {"entries": []}`,
    );
  }

  return {
    entries: (parsed as { entries: QuarantineManifestEntry[] }).entries,
  };
}

function normalizeSpecPath(spec: string): string {
  return spec.replaceAll("\\", "/");
}

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function loadQuarantineManifest(
  opts: LoadQuarantineManifestOpts,
): QuarantineManifest {
  const manifestPath = resolveQuarantineManifestPath(opts);
  if (!manifestPath) {
    throw new Error(`Quarantine manifest not found in ${opts.cwd}`);
  }
  return parseManifestFile(manifestPath);
}

export function loadQuarantineManifestIfExists(
  opts: LoadQuarantineManifestOpts,
): QuarantineManifest | null {
  const manifestPath = resolveQuarantineManifestPath(opts);
  if (!manifestPath) {
    return null;
  }
  return parseManifestFile(manifestPath);
}

export function validateQuarantineManifest(
  opts: ValidateQuarantineManifestOpts,
): QuarantineManifestReport {
  const errors: QuarantineManifestProblem[] = [];
  const warnings: QuarantineManifestProblem[] = [];
  const knownTaskIds = new Set(opts.knownTaskIds ?? []);
  const now = opts.now ?? new Date();
  const expiringWithinDays = opts.expiringWithinDays ?? 7;
  const seenIds = new Set<string>();
  let expiredCount = 0;
  let nearExpiryCount = 0;

  for (const [index, entry] of opts.manifest.entries.entries()) {
    const entryId =
      isNonEmptyString(entry?.id) ? entry.id : `entry-${index + 1}`;

    const pushError = (code: string, message: string) => {
      errors.push({ code, entryId, message });
    };
    const pushWarning = (code: string, message: string) => {
      warnings.push({ code, entryId, message });
    };

    if (!isNonEmptyString(entry?.id)) {
      pushError("invalid-id", "Entry id is required.");
    } else if (seenIds.has(entry.id)) {
      pushError("duplicate-id", `Duplicate entry id: ${entry.id}`);
    } else {
      seenIds.add(entry.id);
    }

    if (!isNonEmptyString(entry?.taskId)) {
      pushError("invalid-task", "taskId is required.");
    } else if (knownTaskIds.size > 0 && !knownTaskIds.has(entry.taskId)) {
      pushError("unknown-task", `Unknown taskId: ${entry.taskId}`);
    }

    if (!isNonEmptyString(entry?.spec)) {
      pushError("invalid-spec", "spec is required.");
    } else {
      const specPath = resolve(opts.cwd, entry.spec);
      if (!existsSync(specPath)) {
        pushError("missing-spec", `Spec does not exist: ${entry.spec}`);
      }
    }

    if (!isNonEmptyString(entry?.titlePattern)) {
      pushError("invalid-pattern", "titlePattern is required.");
    } else {
      try {
        new RegExp(entry.titlePattern);
      } catch {
        pushError("invalid-pattern", `Invalid titlePattern: ${entry.titlePattern}`);
      }
    }

    if (!isNonEmptyString(entry?.mode) || !QUARANTINE_MODES.has(entry.mode)) {
      pushError("invalid-mode", `Unsupported mode: ${String(entry?.mode)}`);
    }

    if (
      !isNonEmptyString(entry?.scope) ||
      !QUARANTINE_SCOPES.has(entry.scope)
    ) {
      pushError("invalid-scope", `Unsupported scope: ${String(entry?.scope)}`);
    }

    for (const field of ["owner", "reason", "condition"] as const) {
      if (!isNonEmptyString(entry?.[field])) {
        pushError(`invalid-${field}`, `${field} is required.`);
      }
    }

    const introducedAt = isNonEmptyString(entry?.introducedAt)
      ? parseDate(entry.introducedAt)
      : null;
    if (!introducedAt) {
      pushError(
        "invalid-introduced-at",
        `Invalid introducedAt: ${String(entry?.introducedAt)}`,
      );
    }

    const expiresAt = isNonEmptyString(entry?.expiresAt)
      ? parseDate(entry.expiresAt)
      : null;
    if (!expiresAt) {
      pushError(
        "invalid-expires-at",
        `Invalid expiresAt: ${String(entry?.expiresAt)}`,
      );
    } else {
      const diffDays = Math.ceil(
        (expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      );
      if (expiresAt.getTime() < now.getTime()) {
        expiredCount++;
        pushError(
          "expired-entry",
          `Entry expired on ${entry.expiresAt}.`,
        );
      } else if (diffDays <= expiringWithinDays) {
        nearExpiryCount++;
        pushWarning(
          "near-expiry",
          `Near expiry: ${entry.expiresAt}.`,
        );
      }
    }
  }

  return {
    manifestPath: opts.manifestPath,
    entries: opts.manifest.entries,
    errors,
    warnings,
    summary: {
      totalEntries: opts.manifest.entries.length,
      errorCount: errors.length,
      warningCount: warnings.length,
      expiredCount,
      nearExpiryCount,
    },
  };
}

function toCoreEntry(entry: QuarantineManifestEntry): QuarantineEntryInput {
  return {
    id: entry.id,
    task_id: entry.taskId,
    spec: normalizeSpecPath(entry.spec),
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

type FindMatchingManifestEntryFn = (
  entries: QuarantineManifestEntry[],
  selector: QuarantineManifestSelector,
  opts?: FindMatchingManifestEntryOpts,
) => QuarantineManifestEntry | undefined;

let findMatchingManifestEntryImpl: FindMatchingManifestEntryFn | undefined;
let quarantineBridgeLoadPromise: Promise<FindMatchingManifestEntryFn> | undefined;

export async function loadQuarantineBridge(): Promise<FindMatchingManifestEntryFn> {
  if (quarantineBridgeLoadPromise) return quarantineBridgeLoadPromise;
  quarantineBridgeLoadPromise = (async () => {
    const mod = (await import(MOONBIT_JS_BRIDGE_URL.href)) as QuarantineMatchExports;
    if (typeof mod.find_matching_quarantine_json !== "function") {
      throw new Error("MoonBit quarantine bridge is missing. Run 'moon build --target js' first.");
    }
    const fn: FindMatchingManifestEntryFn = (entries, selector, opts) => {
      const filteredEntries = opts?.modes
        ? entries.filter((entry) => opts.modes!.includes(entry.mode))
        : entries;
      const resolved = resolveTestIdentity({
        suite: selector.suite,
        testName: selector.testName,
        taskId: selector.taskId,
      });
      const matchedIndex = JSON.parse(
        mod.find_matching_quarantine_json(
          JSON.stringify(filteredEntries.map(toCoreEntry)),
          resolved.taskId,
          normalizeSpecPath(resolved.suite),
          resolved.testName,
        ),
      ) as number;
      return matchedIndex >= 0 ? filteredEntries[matchedIndex] : undefined;
    };
    findMatchingManifestEntryImpl = fn;
    return fn;
  })();
  return quarantineBridgeLoadPromise;
}

export function findMatchingManifestEntry(
  entries: QuarantineManifestEntry[],
  selector: QuarantineManifestSelector,
  opts?: FindMatchingManifestEntryOpts,
): QuarantineManifestEntry | undefined {
  if (!findMatchingManifestEntryImpl) {
    throw new Error(
      "findMatchingManifestEntry called before quarantine bridge was loaded. " +
      "Call loadQuarantineBridge() first.",
    );
  }
  return findMatchingManifestEntryImpl(entries, selector, opts);
}

export function isManifestQuarantined(
  entries: QuarantineManifestEntry[],
  selector: QuarantineManifestSelector,
): boolean {
  return findMatchingManifestEntry(entries, selector, {
    modes: ["skip"],
  }) != null;
}

export function formatQuarantineManifestReport(
  report: QuarantineManifestReport,
  format: "json" | "markdown",
): string {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }

  const lines = [
    "# Quarantine Manifest Report",
    "",
    `- Manifest: \`${report.manifestPath}\``,
    `- Entries: ${report.summary.totalEntries}`,
    `- Errors: ${report.summary.errorCount}`,
    `- Warnings: ${report.summary.warningCount}`,
    "",
    "## Entries",
    "",
    "| ID | Task | Spec | Mode | Scope | Expires At | Owner |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...report.entries.map(
      (entry) =>
        `| ${entry.id} | ${entry.taskId} | ${entry.spec} | ${entry.mode} | ${entry.scope} | ${entry.expiresAt} | ${entry.owner} |`,
    ),
  ];

  if (report.errors.length > 0) {
    lines.push(
      "",
      "## Errors",
      "",
      "| ID | Code | Message |",
      "| --- | --- | --- |",
      ...report.errors.map(
        (error) => `| ${error.entryId} | ${error.code} | ${error.message} |`,
      ),
    );
  }

  if (report.warnings.length > 0) {
    lines.push(
      "",
      "## Warnings",
      "",
      "| ID | Code | Message |",
      "| --- | --- | --- |",
      ...report.warnings.map(
        (warning) =>
          `| ${warning.entryId} | ${warning.code} | ${warning.message} |`,
      ),
    );
  }

  return lines.join("\n");
}
