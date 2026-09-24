import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// Test-only: jev's main entry pulls in @ast-grep/napi, so src/ never imports it.
import { loadRecord, replay } from "jev-test-filter";
import { jevRecordToSelectorRecord, parseJevRecord } from "../../src/cli/selector/jev-record.js";
import { SELECTOR_RECORD_V1_SCHEMA } from "../../src/cli/contracts/selector-record-v1.js";
import { validator } from "./ajv.js";

const fixture = (name: string) => resolve(import.meta.dirname, `../fixtures/jev/${name}`);
const read = (name: string) => JSON.parse(readFileSync(fixture(name), "utf8"));

describe("jev record → selector-record", () => {
  for (const name of ["record-v1.json", "record-v2.json"]) {
    it(`${name}: parses to what jev's own loadRecord returns`, async () => {
      expect(parseJevRecord(read(name))).toEqual(await loadRecord(fixture(name)));
    });

    it(`${name}: per-test selected/reason equal jev's replay under the recorded gate`, async () => {
      const record = await loadRecord(fixture(name));
      const converted = jevRecordToSelectorRecord(parseJevRecord(read(name)))!;
      const expected = replay(record);
      expect(converted.tests.map((t) => [t.reason, t.selected]))
        .toEqual(expected.verdicts.map((v) => [v.reason, v.selected]));
      expect(validator(SELECTOR_RECORD_V1_SCHEMA)(converted)).toBeNull();
    });
  }

  it("v2 keeps shas, digest and gate; v1 has them null", () => {
    const v2 = jevRecordToSelectorRecord(parseJevRecord(read("record-v2.json")))!;
    expect(v2).toMatchObject({
      selector: "jev", source: "real",
      head_sha: "c0ffee0000000000000000000000000000000001",
      context_digest: expect.stringMatching(/^sha256:/),
      gate: { cutoff: 2, unsure_below: 0.5, unsure_margin: 1 },
    });
    expect(v2.tests.map((t) => t.reason)).toEqual(["touched", "unsure", "below", "dynamic", "quarantined"]);
    expect(v2.tests[0]).toMatchObject({ file: "tests/config.test.ts", title_path: ["config", "loads toml"], score: 3, confidence: 0.9 });
    const v1 = jevRecordToSelectorRecord(parseJevRecord(read("record-v1.json")))!;
    expect(v1).toMatchObject({ head_sha: null, base_sha: null, context_digest: null, gate: null });
  });

  it("a record that fell back converts to nothing", () => {
    const r = read("record-v2.json");
    r.fallback = "jev failed: boom";
    expect(jevRecordToSelectorRecord(parseJevRecord(r))).toBeNull();
  });

  it("rejects project, runnerFile and answer values of the wrong type", () => {
    const cases: Array<(r: any) => void> = [
      (r) => { r.tests[0].runnerFile = null; },
      (r) => { r.tests[0].project = 7; },
      (r) => { r.answers[Object.keys(r.answers)[0]] = { value: Number.NaN, confidence: 0.5 }; },
      (r) => { r.answers[Object.keys(r.answers)[0]] = { value: Number.POSITIVE_INFINITY, confidence: 0.5 }; },
    ];
    for (const mutate of cases) {
      const r = read("record-v2.json");
      mutate(r);
      expect(() => parseJevRecord(r)).toThrow(/invalid jev record/);
    }
  });

  it("converts only to records that parseSelectorRecord accepts", () => {
    const r = read("record-v2.json");
    r.tests[0].titlePath = [];
    expect(() => jevRecordToSelectorRecord(parseJevRecord(r))).toThrow(/invalid selector-record/);
  });

  it("rejects an unknown version and a malformed test", () => {
    expect(() => parseJevRecord({ ...read("record-v2.json"), version: 3 })).toThrow(/invalid jev record/);
    const bad = read("record-v2.json");
    bad.tests[0].titlePath = "config";
    expect(() => parseJevRecord(bad)).toThrow(/invalid jev record/);
  });
});
