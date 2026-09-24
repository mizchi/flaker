// tests/selector/replay.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadRecord, replay } from "jev-test-filter";
import { replaySelected, type GateValues } from "../../src/cli/selector/replay.js";
import { jevRecordToSelectorRecord, parseJevRecord } from "../../src/cli/selector/jev-record.js";

const fixture = resolve(import.meta.dirname, "../fixtures/jev/record-v2.json");
const GATES: GateValues[] = [
  { cutoff: 2, unsure_below: 0.5, unsure_margin: 1 },
  { cutoff: 1, unsure_below: 0.5, unsure_margin: 1 },
  { cutoff: 0.3, unsure_below: 0.9, unsure_margin: 0 },
  { cutoff: 3, unsure_below: 0.2, unsure_margin: 2 },
];

describe("replaySelected", () => {
  it("keeps touched / dynamic / quarantined fixed and re-gates the rest", () => {
    const verdicts = [
      { testKey: "a", score: 0, confidence: 1, reason: "touched" },
      { testKey: "b", score: null, confidence: null, reason: "dynamic" },
      { testKey: "c", score: 3, confidence: 1, reason: "quarantined" },
      { testKey: "d", score: 1.5, confidence: 0.9, reason: "below" },
      { testKey: "e", score: null, confidence: null, reason: "missing" },
    ];
    expect(replaySelected(verdicts, { cutoff: 2, unsure_below: 0.5, unsure_margin: 1 }))
      .toEqual([true, true, false, false, true]);
    expect(replaySelected(verdicts, { cutoff: 1.5, unsure_below: 0.5, unsure_margin: 1 }))
      .toEqual([true, true, false, true, true]);
  });

  for (const g of GATES) {
    it(`equals jev's own replay of the record under ${JSON.stringify(g)}`, async () => {
      const record = await loadRecord(fixture);
      const converted = jevRecordToSelectorRecord(parseJevRecord(JSON.parse(readFileSync(fixture, "utf8"))))!;
      const verdicts = converted.tests.map((t) => ({ testKey: null, score: t.score, confidence: t.confidence, reason: t.reason }));
      const expected = replay(record, { cutoff: g.cutoff, unsureBelow: g.unsure_below, unsureMargin: g.unsure_margin });
      expect(replaySelected(verdicts, g)).toEqual(expected.verdicts.map((v) => v.selected));
    });
  }
});
