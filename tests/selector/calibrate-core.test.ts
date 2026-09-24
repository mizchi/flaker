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
});
