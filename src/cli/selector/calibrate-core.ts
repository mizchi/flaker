// src/cli/selector/calibrate-core.ts
/**
 * Selector gate calibration as a pure function: records (verdicts + the
 * failures a full run proved) and the current gate in, the adopted gate and
 * why out. "Tighten at once, loosen with care":
 *
 * - a candidate that misses any observed failure (real or mutation) is out;
 * - a miss under the current gate switches at once to the fewest-selection
 *   candidate that catches everything (tighten);
 * - selecting fewer tests (loosen) needs >= minFailures real failures and a
 *   Wilson 95% lower bound of real recall >= recallTarget;
 * - otherwise keep, and say why. Ties go to the candidate nearest the defaults.
 */
import { replaySelected, type GateValues, type ReplayVerdict } from "./replay.js";
import { wilsonLowerBound } from "./wilson.js";

export interface CalibrationRecord {
  selectorRunId: string;
  source: "real" | "mutation";
  contextDigest: string | null;
  verdicts: ReplayVerdict[];
  /** test_keys that failed in a full run on the record's head (ground truth). */
  failures: string[];
}

export interface CalibrateInput {
  records: CalibrationRecord[];
  current: GateValues;
  defaults: GateValues;
  grid?: GateValues[];
  recallTarget: number;
  minFailures: number;
}

export interface CandidateOutcome {
  gate: GateValues;
  selected: number;
  missed: number;
  realCaught: number;
  realMissed: number;
}

export interface DigestReport {
  contextDigest: string | null;
  records: number;
  failures: number;
  missedUnderCurrent: number;
}

export interface CalibrationDecision {
  decision: "tighten" | "loosen" | "keep";
  gate: GateValues;
  records: number;
  realFailures: number;
  recallLb95: number | null;
  rationale: string;
  current: CandidateOutcome;
  adopted: CandidateOutcome;
  byDigest: DigestReport[];
}

export function buildGrid(cutoffs: number[], unsureBelows: number[], unsureMargins: number[]): GateValues[] {
  return cutoffs.flatMap((cutoff) =>
    unsureBelows.flatMap((unsure_below) =>
      unsureMargins.map((unsure_margin) => ({ cutoff, unsure_below, unsure_margin }))));
}

export const DEFAULT_GRID: GateValues[] = buildGrid(
  [0.5, 1, 1.5, 2, 2.5, 3],
  [0.3, 0.5, 0.7, 0.9],
  [0, 0.5, 1, 1.5, 2],
);

const gateKey = (g: GateValues) => `${g.cutoff}/${g.unsure_below}/${g.unsure_margin}`;
const distance = (a: GateValues, b: GateValues) =>
  Math.abs(a.cutoff - b.cutoff) + Math.abs(a.unsure_below - b.unsure_below) + Math.abs(a.unsure_margin - b.unsure_margin);
const fmt = (g: GateValues) => `cutoff ${g.cutoff} / unsure_below ${g.unsure_below} / unsure_margin ${g.unsure_margin}`;

export function evaluateCandidate(records: readonly CalibrationRecord[], gate: GateValues): CandidateOutcome {
  let selected = 0, missed = 0, realCaught = 0, realMissed = 0;
  for (const r of records) {
    const flags = replaySelected(r.verdicts, gate);
    const keys = new Set<string>();
    r.verdicts.forEach((v, i) => {
      if (!flags[i]) return;
      selected++;
      if (v.testKey) keys.add(v.testKey);
    });
    for (const failure of r.failures) {
      const caught = keys.has(failure);
      if (!caught) missed++;
      if (r.source === "real") {
        if (caught) realCaught++;
        else realMissed++;
      }
    }
  }
  return { gate, selected, missed, realCaught, realMissed };
}

function pickFewest(candidates: CandidateOutcome[], defaults: GateValues): CandidateOutcome {
  return [...candidates].sort((a, b) =>
    a.selected - b.selected
    || distance(a.gate, defaults) - distance(b.gate, defaults)
    || gateKey(a.gate).localeCompare(gateKey(b.gate)))[0];
}

export function calibrateGate(input: CalibrateInput): CalibrationDecision {
  const { records, defaults } = input;
  const realFailures = records.filter((r) => r.source === "real").reduce((n, r) => n + r.failures.length, 0);
  const totalFailures = records.reduce((n, r) => n + r.failures.length, 0);
  const current = evaluateCandidate(records, input.current);
  const lb = (o: CandidateOutcome) => (realFailures === 0 ? null : wilsonLowerBound(o.realCaught, realFailures));

  const byDigest = new Map<string | null, DigestReport>();
  for (const r of records) {
    const entry = byDigest.get(r.contextDigest) ?? { contextDigest: r.contextDigest, records: 0, failures: 0, missedUnderCurrent: 0 };
    entry.records++;
    entry.failures += r.failures.length;
    entry.missedUnderCurrent += evaluateCandidate([r], input.current).missed;
    byDigest.set(r.contextDigest, entry);
  }
  const digestReports = [...byDigest.values()].sort((a, b) => String(a.contextDigest).localeCompare(String(b.contextDigest)));

  const decide = (decision: CalibrationDecision["decision"], adopted: CandidateOutcome, rationale: string): CalibrationDecision => ({
    decision, gate: adopted.gate, records: records.length, realFailures, recallLb95: lb(adopted),
    rationale, current, adopted, byDigest: digestReports,
  });

  if (records.length === 0) {
    return decide("keep", current, "no selector record has a full run on its head commit yet");
  }

  const seen = new Set<string>();
  const candidates = [...(input.grid ?? DEFAULT_GRID), input.current, defaults]
    .filter((g) => (seen.has(gateKey(g)) ? false : (seen.add(gateKey(g)), true)))
    .map((g) => evaluateCandidate(records, g));
  const feasible = candidates.filter((c) => c.missed === 0);

  if (current.missed > 0) {
    if (feasible.length === 0) {
      return decide("keep", current,
        `the current gate misses ${current.missed} of ${totalFailures} failures and no candidate in the grid catches all of them`);
    }
    const best = pickFewest(feasible, defaults);
    return decide("tighten", best,
      `the current gate (${fmt(input.current)}) missed ${current.missed} of ${totalFailures} failures; ${fmt(best.gate)} catches all of them with the fewest selected tests`);
  }

  const looser = feasible.filter((c) => c.selected < current.selected);
  if (looser.length === 0) {
    return decide("keep", current, "no candidate selects fewer tests without missing a failure");
  }
  if (realFailures < input.minFailures) {
    return decide("keep", current,
      `only ${realFailures} real failures observed; loosening needs at least ${input.minFailures}`);
  }
  const best = pickFewest(looser, defaults);
  const bound = lb(best) ?? 0;
  if (bound < input.recallTarget) {
    return {
      ...decide("keep", current,
        `recall lower bound ${bound.toFixed(3)} over ${realFailures} real failures is below the target ${input.recallTarget}`),
      recallLb95: bound,
    };
  }
  return decide("loosen", best,
    `${fmt(best.gate)} selects ${current.selected - best.selected} fewer tests and still catches all ${realFailures} real failures (recall lower bound ${bound.toFixed(3)})`);
}
