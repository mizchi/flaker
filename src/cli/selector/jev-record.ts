/**
 * jev-test-filter's run record (v1 or v2) → flaker's selector-record v1.
 *
 * The reason and selection of every test come from jev's own `gate()`
 * (bundled from `jev-test-filter/gate`), under the gate the record was
 * decided with. flaker never re-implements that decision.
 *
 * `touched` and `quarantined` are keyed by jev's `testId` (it includes the
 * line); `answers` by question id, which is the test's index in `tests`. Both
 * are resolved to the test itself here, so nothing downstream sees them.
 */
import { gate, gateOptions, resolveGate } from "jev-test-filter/gate";
import type { Answer, RunRecord, TestCase } from "jev-test-filter/types";
import type { SelectorRecordV1 } from "../contracts/selector-record-v1.js";
import { SELECTOR_RECORD_KIND } from "../contracts/selector-record-v1.js";

function fail(what: string): never {
  throw new Error(`invalid jev record: ${what}`);
}
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown, at: string): string[] => {
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) fail(`${at} must be an array of strings`);
  return [...v];
};
const nullableString = (v: unknown, at: string): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") fail(`${at} must be a string or null`);
  return v;
};

function readTest(v: unknown, at: string): TestCase {
  if (!isObj(v)) fail(`${at} must be an object`);
  if (typeof v.file !== "string") fail(`${at}.file must be a string`);
  const titlePath = strings(v.titlePath, `${at}.titlePath`);
  if (typeof v.line !== "number" || typeof v.endLine !== "number") fail(`${at}.line/endLine must be numbers`);
  if (typeof v.framework !== "string") fail(`${at}.framework must be a string`);
  if (typeof v.dynamic !== "boolean") fail(`${at}.dynamic must be a boolean`);
  return {
    ...(v as unknown as TestCase),
    file: v.file,
    titlePath,
    line: v.line,
    endLine: v.endLine,
    dynamic: v.dynamic,
  };
}

function readAnswers(v: unknown): Record<string, Answer | null> {
  if (!isObj(v)) fail("answers must be an object");
  const out: Record<string, Answer | null> = {};
  for (const [id, a] of Object.entries(v)) {
    if (a === null) { out[id] = null; continue; }
    if (!isObj(a) || typeof a.value !== "number" || !(a.confidence === null || typeof a.confidence === "number")) {
      fail(`answers.${id} must be null or { value: number, confidence: number | null }`);
    }
    out[id] = { value: a.value, confidence: a.confidence as number | null };
  }
  return out;
}

function readGate(v: unknown): RunRecord["gate"] {
  if (!isObj(v)) fail("gate must be an object");
  for (const key of ["cutoff", "unsure_below", "unsure_margin"] as const) {
    if (typeof v[key] !== "number") fail(`gate.${key} must be a number`);
  }
  return { cutoff: v.cutoff as number, unsure_below: v.unsure_below as number, unsure_margin: v.unsure_margin as number };
}

/** Validate and normalize a parsed record, the same way jev's `loadRecord` does. */
export function parseJevRecord(raw: unknown): RunRecord {
  if (!isObj(raw)) fail("expected a JSON object");
  if (raw.version !== 1 && raw.version !== 2) fail(`unsupported version ${String(raw.version)}`);
  if (!Array.isArray(raw.tests)) fail("tests must be an array");
  const common = {
    ...raw,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : fail("createdAt must be a string"),
    base: nullableString(raw.base, "base"),
    framework: raw.framework as TestCase["framework"],
    tests: raw.tests.map((t, i) => readTest(t, `tests[${i}]`)),
    touched: strings(raw.touched, "touched"),
    answers: readAnswers(raw.answers),
    fallback: nullableString(raw.fallback, "fallback"),
  };
  if (raw.version === 1) {
    return { ...common, version: 1, head_sha: null, base_sha: null, context_digest: null, gate: null, quarantined: [] } as RunRecord;
  }
  return {
    ...common,
    version: 2,
    head_sha: nullableString(raw.head_sha, "head_sha"),
    base_sha: nullableString(raw.base_sha, "base_sha"),
    context_digest: nullableString(raw.context_digest, "context_digest"),
    // A v2 record without a gate reads as jev's defaults, exactly as jev's loadRecord does.
    gate: raw.gate === undefined ? resolveGate() : readGate(raw.gate),
    quarantined: raw.quarantined === undefined ? [] : strings(raw.quarantined, "quarantined"),
  } as RunRecord;
}

/** Null for a record that fell back: it holds no decisions. */
export function jevRecordToSelectorRecord(record: RunRecord): SelectorRecordV1 | null {
  if (record.fallback !== null) return null;
  const selection = gate(
    record.tests,
    new Map(Object.entries(record.answers)),
    new Set(record.touched),
    gateOptions(record.gate),
    new Set(record.quarantined),
  );
  return {
    version: 1,
    kind: SELECTOR_RECORD_KIND,
    selector: "jev",
    selector_version: null,
    created_at: record.createdAt,
    head_sha: record.head_sha,
    base_sha: record.base_sha,
    context_digest: record.context_digest,
    source: "real",
    gate: record.gate,
    tests: selection.verdicts.map((v) => ({
      file: v.test.file,
      title_path: [...v.test.titlePath],
      ...(v.test.project ? { project: v.test.project } : {}),
      ...(v.test.runnerFile !== undefined ? { runner_file: v.test.runnerFile } : {}),
      score: v.answer?.value ?? null,
      confidence: v.answer?.confidence ?? null,
      reason: v.reason,
      selected: v.selected,
    })),
  };
}
