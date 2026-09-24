import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SELECTOR_RECORD_V1_SCHEMA,
  parseSelectorRecord,
  selectorRunId,
} from "../../src/cli/contracts/selector-record-v1.js";
import { canonicalJson } from "../../src/cli/contracts/canonical-json.js";
import { validator } from "./ajv.js";

const valid = JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/selector-record/valid.json"), "utf8"));
const check = validator(SELECTOR_RECORD_V1_SCHEMA);

/** The same value with every object's keys in reverse order, at every depth. */
function reverseKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (v === null || typeof v !== "object") return v;
  return Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)]));
}

describe("selector-record v1", () => {
  it("accepts the fixture in both the parser and the schema", () => {
    expect(check(valid)).toBeNull();
    const parsed = parseSelectorRecord(valid);
    expect(parsed.tests[1]).toMatchObject({ project: "chromium", runner_file: "p.spec.ts" });
  });

  const invalid: Array<[string, (r: any) => void]> = [
    ["wrong version", (r) => { r.version = 2; }],
    ["wrong kind", (r) => { r.kind = "other"; }],
    ["empty selector", (r) => { r.selector = ""; }],
    ["bad created_at", (r) => { r.created_at = "yesterday"; }],
    ["bad source", (r) => { r.source = "synthetic"; }],
    ["gate value not a number", (r) => { r.gate.cutoff = "2"; }],
    ["tests not an array", (r) => { r.tests = {}; }],
    ["title_path not strings", (r) => { r.tests[0].title_path = [1]; }],
    ["empty title_path", (r) => { r.tests[0].title_path = []; }],
    ["a created_at that is not RFC 3339", (r) => { r.created_at = "Sep 24 2026"; }],
    ["selected not boolean", (r) => { r.tests[0].selected = "no"; }],
    ["score not a number", (r) => { r.tests[0].score = "high"; }],
  ];
  for (const [name, mutate] of invalid) {
    it(`rejects ${name} in both the parser and the schema`, () => {
      const r = structuredClone(valid);
      mutate(r);
      expect(check(r)).not.toBeNull();
      expect(() => parseSelectorRecord(r)).toThrow(/invalid selector-record/);
    });
  }

  it("accepts an RFC 3339 offset and reads an empty project as none", () => {
    const r = structuredClone(valid);
    r.created_at = "2026-09-20T19:00:00+09:00";
    r.tests[1].project = "";
    const parsed = parseSelectorRecord(r);
    expect(parsed.created_at).toBe("2026-09-20T19:00:00+09:00");
    expect(parsed.tests[1]).not.toHaveProperty("project");
  });

  it("derives a stable run id from the content", () => {
    const a = selectorRunId(parseSelectorRecord(valid));
    const reordered = reverseKeys(valid);
    expect(selectorRunId(parseSelectorRecord(reordered))).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it("canonicalJson sorts keys and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: [{ d: undefined, c: 2 }] })).toBe(`{"a":[{"c":2}],"b":1}`);
  });
});
