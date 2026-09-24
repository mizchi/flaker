// src/cli/selector/replay.ts
/**
 * Re-gate stored verdicts under other gate values, offline. The per-test
 * decision is jev's `decide` (bundled from jev-test-filter/gate); the one rule
 * `gate()` applies before it -- a quarantined test is never selected -- is
 * carried by the stored reason. tests/selector/replay.test.ts pins this to
 * jev's own `replay()` so the two cannot drift.
 */
import { decide } from "jev-test-filter/gate";
import type { TestCase } from "jev-test-filter/types";

export interface GateValues {
  cutoff: number;
  unsure_below: number;
  unsure_margin: number;
}

export interface ReplayVerdict {
  testKey: string | null;
  score: number | null;
  confidence: number | null;
  reason: string;
}

export function replaySelected(verdicts: readonly ReplayVerdict[], g: GateValues): boolean[] {
  const opts = { cutoff: g.cutoff, unsureBelow: g.unsure_below, unsureMargin: g.unsure_margin };
  return verdicts.map((v, i) => {
    if (v.reason === "quarantined") return false;
    const test: TestCase = {
      file: "", titlePath: [String(i)], line: 0, endLine: 0, framework: "unknown",
      dynamic: v.reason === "dynamic",
    };
    const answer = v.score === null ? null : { value: v.score, confidence: v.confidence };
    return decide(`r${i}`, test, answer, v.reason === "touched", opts).selected;
  });
}
