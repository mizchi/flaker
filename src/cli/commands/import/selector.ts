// src/cli/commands/import/selector.ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { MetricStore } from "../../storage/types.js";
import { parseSelectorRecord, type SelectorRecordV1 } from "../../contracts/selector-record-v1.js";
import { jevRecordToSelectorRecord, parseJevRecord } from "../../selector/jev-record.js";
import { insertSelectorRecord, resolveSelectorTestKeys } from "../../selector/store.js";

export const SELECTOR_ADAPTERS = ["selector-record", "jev"] as const;
export type SelectorAdapter = (typeof SELECTOR_ADAPTERS)[number];

export function isSelectorAdapter(value: string | undefined): value is SelectorAdapter {
  return value !== undefined && (SELECTOR_ADAPTERS as readonly string[]).includes(value);
}

export interface ImportSelectorResult {
  files: number;
  imported: number;
  duplicates: number;
  skipped: Array<{ file: string; reason: string }>;
  invalid: Array<{ file: string; error: string }>;
  /** Parsed, but the database rejected the insert. */
  failed: Array<{ file: string; error: string }>;
  warnings: string[];
  resolved: number;
  unresolved: number;
}

/** The import path does not exist. The message is meant for the user as it is. */
export class SelectorImportPathError extends Error {
  constructor(readonly path: string) {
    super(`no such file or directory: ${path}`);
    this.name = "SelectorImportPathError";
  }
}

/** A file as it is; a directory's *.json, then its records/*.json (jev's layout). Sorted. */
export function listRecordFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  const jsonIn = (dir: string) =>
    readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => join(dir, f));
  const records = join(path, "records");
  return [...jsonIn(path), ...(existsSync(records) && statSync(records).isDirectory() ? jsonIn(records) : [])];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toSelectorRecord(adapter: SelectorAdapter, raw: unknown): SelectorRecordV1 | null {
  return adapter === "jev" ? jevRecordToSelectorRecord(parseJevRecord(raw)) : parseSelectorRecord(raw);
}

export async function runImportSelector(opts: {
  store: MetricStore;
  path: string;
  adapter: SelectorAdapter;
}): Promise<ImportSelectorResult> {
  if (!existsSync(opts.path)) throw new SelectorImportPathError(opts.path);
  const files = listRecordFiles(opts.path);
  const result: ImportSelectorResult = {
    files: files.length, imported: 0, duplicates: 0, skipped: [], invalid: [], failed: [], warnings: [],
    resolved: 0, unresolved: 0,
  };
  if (files.length === 0) result.warnings.push(`no .json records found in ${opts.path}`);
  for (const file of files) {
    let record: SelectorRecordV1 | null;
    try {
      record = toSelectorRecord(opts.adapter, JSON.parse(readFileSync(file, "utf8")));
    } catch (err) {
      result.invalid.push({ file, error: errorMessage(err) });
      continue;
    }
    if (record === null) {
      result.skipped.push({ file, reason: "fallback" });
      continue;
    }
    try {
      const { inserted } = await insertSelectorRecord(opts.store, record);
      if (inserted) result.imported++;
      else result.duplicates++;
    } catch (err) {
      result.failed.push({ file, error: errorMessage(err) });
    }
  }
  const keys = await resolveSelectorTestKeys(opts.store);
  result.resolved = keys.resolved;
  result.unresolved = keys.unresolved;
  return result;
}

export function formatImportSelector(r: ImportSelectorResult): string {
  const parts = [`Imported ${r.imported} selector run${r.imported === 1 ? "" : "s"}`];
  if (r.duplicates > 0) parts.push(`${r.duplicates} duplicate`);
  if (r.skipped.length > 0) parts.push(`${r.skipped.length} skipped (fell back)`);
  if (r.invalid.length > 0) parts.push(`${r.invalid.length} invalid`);
  if (r.failed.length > 0) parts.push(`${r.failed.length} failed`);
  const lines = [parts.join(", ")];
  if (r.resolved + r.unresolved > 0) {
    // Resolution runs over every verdict still unmatched, not only this import's.
    lines.push(`${r.resolved} of ${r.resolved + r.unresolved} unresolved tests in the database now match a known test`);
  }
  return lines.join("\n");
}

/** stderr lines and the exit code: 1 when any file was invalid or failed to import. */
export function importSelectorDiagnostics(r: ImportSelectorResult): { stderr: string[]; exitCode: number } {
  const stderr = [
    ...r.warnings.map((w) => `warning: ${w}`),
    ...[...r.invalid, ...r.failed].map((e) => `${e.file}: ${e.error}`),
  ];
  return { stderr, exitCode: r.invalid.length + r.failed.length > 0 ? 1 : 0 };
}
