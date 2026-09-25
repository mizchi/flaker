/**
 * `selector-record` v1: a selector's per-test decisions for one change, in
 * the shape flaker ingests (`flaker import --adapter selector-record`). Any
 * selector that writes it can be calibrated by `flaker calibrate --selector`.
 *
 * Replay semantics: `reason` values "touched", "dynamic" and "quarantined" are
 * decided by the change, not by the gate, and stay fixed under any gate; every
 * other test is re-gated from `score` / `confidence` (null score = no answer,
 * always selected).
 */
import { canonicalJson, sha256Hex } from "./canonical-json.js";
import {
  BOOL, NUM, NUM_OR_NULL, STR, STR_OR_NULL, STRINGS, RFC3339, TIME, oneOf, type JsonSchema,
} from "./json-schema.js";

export const SELECTOR_RECORD_KIND = "flaker-selector-record";

export interface SelectorGateValues {
  cutoff: number;
  unsure_below: number;
  unsure_margin: number;
}

export interface SelectorRecordTestV1 {
  file: string;
  title_path: string[];
  project?: string;
  /** The path as the runner spells it, when it differs from `file` (Playwright rootDir). */
  runner_file?: string;
  score: number | null;
  confidence: number | null;
  reason: string;
  selected: boolean;
}

export interface SelectorRecordV1 {
  version: 1;
  kind: typeof SELECTOR_RECORD_KIND;
  selector: string;
  selector_version: string | null;
  created_at: string;
  head_sha: string | null;
  base_sha: string | null;
  context_digest: string | null;
  source: "real" | "mutation";
  /** The gate values the decisions were made under; null when unknown. */
  gate: SelectorGateValues | null;
  tests: SelectorRecordTestV1[];
}

const GATE: JsonSchema = {
  type: ["object", "null"],
  required: ["cutoff", "unsure_below", "unsure_margin"],
  properties: { cutoff: NUM, unsure_below: NUM, unsure_margin: NUM },
};

export const SELECTOR_RECORD_V1_SCHEMA: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/mizchi/flaker/contracts/selector-record-v1.json",
  title: "flaker selector-record v1",
  type: "object",
  required: ["version", "kind", "selector", "created_at", "tests"],
  properties: {
    version: { const: 1 },
    kind: { const: SELECTOR_RECORD_KIND },
    selector: { type: "string", minLength: 1 },
    selector_version: STR_OR_NULL,
    created_at: TIME,
    head_sha: STR_OR_NULL,
    base_sha: STR_OR_NULL,
    context_digest: STR_OR_NULL,
    source: oneOf("real", "mutation"),
    gate: GATE,
    tests: {
      type: "array",
      items: {
        type: "object",
        required: ["file", "title_path", "score", "confidence", "reason", "selected"],
        properties: {
          file: STR, title_path: { ...STRINGS, minItems: 1 }, project: STR, runner_file: STR,
          score: NUM_OR_NULL, confidence: NUM_OR_NULL, reason: STR, selected: BOOL,
        },
      },
    },
  },
};

function fail(what: string): never {
  throw new Error(`invalid selector-record: ${what}`);
}
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
function nullableString(v: unknown, at: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") fail(`${at} must be a string or null`);
  return v;
}
function nullableNumber(v: unknown, at: string): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${at} must be a number or null`);
  return v;
}
function optionalString(v: unknown, at: string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string") fail(`${at} must be a string`);
  return v;
}

function parseGate(v: unknown): SelectorGateValues | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) fail("gate must be an object or null");
  const out: Record<string, number> = {};
  for (const key of ["cutoff", "unsure_below", "unsure_margin"] as const) {
    const n = v[key];
    if (typeof n !== "number" || !Number.isFinite(n)) fail(`gate.${key} must be a number`);
    out[key] = n;
  }
  return out as unknown as SelectorGateValues;
}

function parseTest(v: unknown, at: string): SelectorRecordTestV1 {
  if (!isObj(v)) fail(`${at} must be an object`);
  if (typeof v.file !== "string" || v.file === "") fail(`${at}.file must be a non-empty string`);
  if (!Array.isArray(v.title_path) || v.title_path.length === 0 || !v.title_path.every((s) => typeof s === "string")) {
    fail(`${at}.title_path must be a non-empty array of strings`);
  }
  if (typeof v.reason !== "string" || v.reason === "") fail(`${at}.reason must be a non-empty string`);
  if (typeof v.selected !== "boolean") fail(`${at}.selected must be a boolean`);
  // An empty project means none, as it does for the matcher and the jev converter.
  const project = optionalString(v.project, `${at}.project`) || undefined;
  const runnerFile = optionalString(v.runner_file, `${at}.runner_file`);
  return {
    file: v.file,
    title_path: [...(v.title_path as string[])],
    ...(project === undefined ? {} : { project }),
    ...(runnerFile === undefined ? {} : { runner_file: runnerFile }),
    score: nullableNumber(v.score, `${at}.score`),
    confidence: nullableNumber(v.confidence, `${at}.confidence`),
    reason: v.reason,
    selected: v.selected,
  };
}

export function parseSelectorRecord(raw: unknown): SelectorRecordV1 {
  if (!isObj(raw)) fail("expected a JSON object");
  if (raw.version !== 1) fail(`unsupported version ${String(raw.version)}; expected 1`);
  if (raw.kind !== SELECTOR_RECORD_KIND) fail(`kind must be "${SELECTOR_RECORD_KIND}"`);
  if (typeof raw.selector !== "string" || raw.selector === "") fail("selector must be a non-empty string");
  if (typeof raw.created_at !== "string" || !RFC3339.test(raw.created_at) || Number.isNaN(Date.parse(raw.created_at))) {
    fail("created_at must be an RFC 3339 date-time");
  }
  const source = raw.source ?? "real";
  if (source !== "real" && source !== "mutation") fail(`source must be "real" or "mutation"`);
  if (!Array.isArray(raw.tests)) fail("tests must be an array");
  return {
    version: 1,
    kind: SELECTOR_RECORD_KIND,
    selector: raw.selector,
    selector_version: nullableString(raw.selector_version, "selector_version"),
    created_at: raw.created_at,
    head_sha: nullableString(raw.head_sha, "head_sha"),
    base_sha: nullableString(raw.base_sha, "base_sha"),
    context_digest: nullableString(raw.context_digest, "context_digest"),
    source,
    gate: parseGate(raw.gate),
    tests: raw.tests.map((t, i) => parseTest(t, `tests[${i}]`)),
  };
}

/** Content-derived id: re-importing the same record is a no-op. */
export function selectorRunId(record: SelectorRecordV1): string {
  return sha256Hex(canonicalJson(record)).slice(0, 32);
}
