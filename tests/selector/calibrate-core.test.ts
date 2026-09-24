// tests/selector/calibrate-core.test.ts
import { describe, expect, it } from "vitest";
import {
  calibrateGate, DEFAULT_GRID, type CalibrationRecord,
} from "../../src/cli/selector/calibrate-core.js";
import type { GateValues } from "../../src/cli/selector/replay.js";

const DEFAULTS: GateValues = { cutoff: 2, unsure_below: 0.5, unsure_margin: 1 };

/** One record: a failing test with this score, plus passing tests with these scores. All confident. */
function record(id: string, failingScore: number, passing: number[], source: "real" | "mutation" = "real"): CalibrationRecord {
  return {
    selectorRunId: id,
    source,
    contextDigest: null,
    verdicts: [
      { testKey: `${id}:fail`, score: failingScore, confidence: 0.9, reason: failingScore >= 2 ? "scored" : "below" },
      ...passing.map((s, i) => ({ testKey: `${id}:p${i}`, score: s, confidence: 0.9, reason: s >= 2 ? "scored" : "below" })),
    ],
    failures: [`${id}:fail`],
  };
}
const many = (n: number, score: number, passing: number[], source: "real" | "mutation" = "real") =>
  Array.from({ length: n }, (_, i) => record(`r${i}`, score, passing, source));

const base = { defaults: DEFAULTS, recallTarget: 0.98, minFailures: 20 };

describe("calibrateGate", () => {
  it("keeps, with a reason, when no record has ground truth", () => {
    const d = calibrateGate({ ...base, records: [], current: DEFAULTS });
    expect(d).toMatchObject({ decision: "keep", gate: DEFAULTS, records: 0, realFailures: 0, recallLb95: null });
    expect(d.rationale).toMatch(/no selector record/);
  });

  it("tightens at once on a single miss, to the fewest-selection gate that catches it", () => {
    const d = calibrateGate({ ...base, records: [record("a", 1.2, [0.2, 0.4, 0.8])], current: DEFAULTS });
    expect(d.decision).toBe("tighten");
    expect(d.gate).toEqual({ cutoff: 1, unsure_below: 0.5, unsure_margin: 1 });
    expect(d.current.missed).toBe(1);
    expect(d.adopted).toMatchObject({ missed: 0, selected: 1 });
  });

  it("mutation failures justify tightening too", () => {
    const d = calibrateGate({ ...base, records: [record("m", 1.2, [0.2], "mutation")], current: DEFAULTS });
    expect(d.decision).toBe("tighten");
  });

  it("keeps when too few real failures are observed to loosen", () => {
    const current = { cutoff: 1.5, unsure_below: 0.5, unsure_margin: 1 };
    const d = calibrateGate({ ...base, records: many(5, 2.5, [1.6]), current });
    expect(d.decision).toBe("keep");
    expect(d.gate).toEqual(current);
    expect(d.rationale).toMatch(/only 5 real failures.*at least 20/);
  });

  it("keeps when the recall lower bound misses the target (20 of 20 → 0.839 < 0.98)", () => {
    const current = { cutoff: 1.5, unsure_below: 0.5, unsure_margin: 1 };
    const d = calibrateGate({ ...base, records: many(20, 2.5, [1.6]), current });
    expect(d.decision).toBe("keep");
    expect(d.recallLb95).toBeCloseTo(0.8389, 4);
    expect(d.rationale).toMatch(/below the target 0.98/);
  });

  it("loosens when there are enough real failures and the bound meets the target; ties go to the defaults", () => {
    const current = { cutoff: 1.5, unsure_below: 0.5, unsure_margin: 1 };
    const d = calibrateGate({ ...base, recallTarget: 0.8, records: many(20, 2.5, [1.6]), current });
    expect(d.decision).toBe("loosen");
    expect(d.gate).toEqual(DEFAULTS);
    expect(d.adopted.selected).toBeLessThan(d.current.selected);
  });

  it("mutation failures never justify loosening", () => {
    const current = { cutoff: 1.5, unsure_below: 0.5, unsure_margin: 1 };
    const d = calibrateGate({ ...base, recallTarget: 0.5, minFailures: 1, records: many(30, 2.5, [1.6], "mutation"), current });
    expect(d.decision).toBe("keep");
    expect(d.realFailures).toBe(0);
  });

  it("keeps when no looser candidate avoids every miss", () => {
    const d = calibrateGate({ ...base, records: many(3, 2, [0.1]), current: DEFAULTS });
    expect(d.decision).toBe("keep");
    expect(d.rationale).toMatch(/no candidate selects fewer/);
  });

  it("reports per context digest", () => {
    const a = { ...record("a", 1.2, [0.2]), contextDigest: "sha256:aa" };
    const b = { ...record("b", 2.5, [0.2]), contextDigest: "sha256:bb" };
    const d = calibrateGate({ ...base, records: [a, b], current: DEFAULTS });
    expect(d.byDigest).toEqual([
      { contextDigest: "sha256:aa", records: 1, failures: 1, missedUnderCurrent: 1 },
      { contextDigest: "sha256:bb", records: 1, failures: 1, missedUnderCurrent: 0 },
    ]);
  });

  it("the default grid includes the defaults and a cutoff low enough to catch any scored failure", () => {
    expect(DEFAULT_GRID).toContainEqual(DEFAULTS);
    expect(Math.min(...DEFAULT_GRID.map((g) => g.cutoff))).toBeLessThanOrEqual(0.5);
  });

  it("does not count a failure of a test the record quarantined: the selector could not pick it", () => {
    const r: CalibrationRecord = {
      selectorRunId: "q", source: "real", contextDigest: null,
      verdicts: [
        { testKey: "q:fail", score: 3, confidence: 1, reason: "quarantined" },
        { testKey: "q:p0", score: 0.2, confidence: 0.9, reason: "below" },
      ],
      failures: ["q:fail"],
    };
    const d = calibrateGate({ ...base, records: [r], current: DEFAULTS });
    expect(d.decision).toBe("keep");
    expect(d.gate).toEqual(DEFAULTS);
    expect(d.realFailures).toBe(0);
    expect(d.quarantinedFailures).toBe(1);
    expect(d.current.missed).toBe(0);
    expect(d.rationale).toMatch(/1 failure of a quarantined test is not counted/);
  });

  it("still tightens when no candidate catches every failure, to the fewest misses", () => {
    const r: CalibrationRecord = {
      selectorRunId: "u", source: "real", contextDigest: null,
      verdicts: [
        { testKey: "u:low", score: 0.3, confidence: 0.9, reason: "below" },
        { testKey: "u:mid", score: 1.2, confidence: 0.9, reason: "below" },
        { testKey: "u:p0", score: 0.1, confidence: 0.9, reason: "below" },
      ],
      failures: ["u:low", "u:mid"],
    };
    const d = calibrateGate({ ...base, records: [r], current: DEFAULTS });
    expect(d.decision).toBe("tighten");
    expect(d.current.missed).toBe(2);
    expect(d.adopted.missed).toBe(1);
    expect(d.gate).toEqual({ cutoff: 1, unsure_below: 0.5, unsure_margin: 1 });
    expect(d.rationale).toMatch(/no candidate in the grid catches all/);
  });

  it("keeps the gate when no candidate misses fewer: selecting more would not catch the miss", () => {
    const r: CalibrationRecord = {
      selectorRunId: "z", source: "real", contextDigest: null,
      verdicts: [
        { testKey: "z:low", score: 0.3, confidence: 0.9, reason: "below" },
        { testKey: "z:p0", score: 1.2, confidence: 0.9, reason: "below" },
      ],
      failures: ["z:low"],
    };
    const d = calibrateGate({ ...base, records: [r], current: DEFAULTS });
    expect(d.decision).toBe("keep");
    expect(d.gate).toEqual(DEFAULTS);
    expect(d.current.missed).toBe(1);
    expect(d.rationale).toMatch(/no candidate in the grid misses fewer/);
  });

  it("a tighten candidate keeps every test the current gate selects (no dropped unsure rescues)", () => {
    const r: CalibrationRecord = {
      selectorRunId: "s", source: "real", contextDigest: null,
      verdicts: [
        { testKey: "s:x", score: 1.6, confidence: 0.9, reason: "below" },
        { testKey: "s:rescued", score: 1.2, confidence: 0.4, reason: "unsure" },
      ],
      failures: ["s:x"],
    };
    const d = calibrateGate({ ...base, records: [r], current: DEFAULTS });
    expect(d.decision).toBe("tighten");
    expect(d.gate).not.toEqual({ cutoff: 1.5, unsure_below: 0.3, unsure_margin: 0 });
    expect(d.adopted).toMatchObject({ missed: 0, selected: 2 });
  });

  it("says a loosening needs zero misses and how many real failures that takes", () => {
    const current = { cutoff: 1.5, unsure_below: 0.5, unsure_margin: 1 };
    const few = calibrateGate({ ...base, recallTarget: 0.9, records: many(5, 2.5, [1.6]), current });
    expect(few.rationale).toMatch(/zero misses/);
    expect(few.rationale).toMatch(/at least 35 real failures/);
    const enough = calibrateGate({ ...base, recallTarget: 0.9, records: many(25, 2.5, [1.6]), current });
    expect(enough.decision).toBe("keep");
    expect(enough.rationale).toMatch(/below the target 0.9.*at least 35 real failures/);
  });
});
