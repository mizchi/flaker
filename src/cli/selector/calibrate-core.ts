// src/cli/selector/calibrate-core.ts
/**
 * Selector gate calibration as a pure function: records (verdicts + the
 * failures a full run proved) and the current gate in, the adopted gate and
 * why out. "Tighten at once, loosen with care":
 *
 * - a failure of a test the record quarantined is not the selector's miss:
 *   it could never pick that test. Such failures are counted apart;
 * - a miss under the current gate switches at once (tighten) to a candidate
 *   that selects, on every record, everything the current gate selects. Among
 *   those: fewest misses, then fewest selected tests. When no candidate
 *   catches every failure the one with the fewest misses is still adopted;
 *   when no candidate misses fewer than the current gate, it is kept;
 * - selecting fewer tests (loosen) needs zero misses, >= minFailures real
 *   failures and a Wilson 95% lower bound of real recall >= recallTarget.
 *   With zero misses the bound is n / (n + z^2), so recallTarget 0.90 needs
 *   at least 35 real failures whatever minFailures says;
 * - otherwise keep, and say why. Ties go to the candidate nearest the defaults.
 */
import { replaySelected, type GateValues, type ReplayVerdict } from "./replay.js";
import { perfectRunsNeeded, wilsonLowerBound } from "./wilson.js";

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
  /** Failures of tests the record quarantined: not counted as misses or as evidence. */
  quarantinedFailures: number;
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

/** Drop failures of tests a record quarantined; return the records and how many were dropped. */
function withoutQuarantined(records: readonly CalibrationRecord[]): { records: CalibrationRecord[]; dropped: number } {
  let dropped = 0;
  const out = records.map((r) => {
    const quarantined = new Set(r.verdicts.filter((v) => v.reason === "quarantined" && v.testKey).map((v) => v.testKey!));
    const failures = r.failures.filter((f) => !quarantined.has(f));
    dropped += r.failures.length - failures.length;
    return failures.length === r.failures.length ? r : { ...r, failures };
  });
  return { records: out, dropped };
}

/** Whether `flags` selects, on every record, everything `base` selects. */
function coversSelection(flags: boolean[][], base: boolean[][]): boolean {
  return base.every((row, r) => row.every((selected, i) => !selected || flags[r][i]));
}

const needText = (target: number) => {
  const n = perfectRunsNeeded(target);
  return Number.isFinite(n) ? `at least ${n} real failures` : "more real failures than any finite count (recall_target is 1)";
};

function pickFewest(candidates: CandidateOutcome[], defaults: GateValues): CandidateOutcome {
  return [...candidates].sort((a, b) =>
    a.selected - b.selected
    || distance(a.gate, defaults) - distance(b.gate, defaults)
    || gateKey(a.gate).localeCompare(gateKey(b.gate)))[0];
}

export function calibrateGate(input: CalibrateInput): CalibrationDecision {
  const { defaults } = input;
  const { records, dropped: quarantinedFailures } = withoutQuarantined(input.records);
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

  const quarantineNote = quarantinedFailures === 0 ? ""
    : quarantinedFailures === 1 ? "; 1 failure of a quarantined test is not counted"
    : `; ${quarantinedFailures} failures of quarantined tests are not counted`;
  const decide = (decision: CalibrationDecision["decision"], adopted: CandidateOutcome, rationale: string): CalibrationDecision => ({
    decision, gate: adopted.gate, records: records.length, realFailures, quarantinedFailures, recallLb95: lb(adopted),
    rationale: rationale + quarantineNote, current, adopted, byDigest: digestReports,
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
    const currentFlags = records.map((r) => replaySelected(r.verdicts, input.current));
    const tighter = candidates.filter((c) =>
      c.missed < current.missed
      && coversSelection(records.map((r) => replaySelected(r.verdicts, c.gate)), currentFlags));
    if (tighter.length === 0) {
      return decide("keep", current,
        `the current gate misses ${current.missed} of ${totalFailures} failures and no candidate in the grid misses fewer, so selecting more tests would not catch them`);
    }
    const fewestMisses = Math.min(...tighter.map((c) => c.missed));
    const best = pickFewest(tighter.filter((c) => c.missed === fewestMisses), defaults);
    const missedText = `the current gate (${fmt(input.current)}) missed ${current.missed} of ${totalFailures} failures`;
    return decide("tighten", best, best.missed === 0
      ? `${missedText}; ${fmt(best.gate)} catches all of them with the fewest selected tests while keeping every test the current gate selects`
      : `${missedText} and no candidate in the grid catches all of them; ${fmt(best.gate)} misses the fewest (${best.missed}) while keeping every test the current gate selects`);
  }

  const looser = feasible.filter((c) => c.selected < current.selected);
  if (looser.length === 0) {
    return decide("keep", current, "no candidate selects fewer tests without missing a failure");
  }
  if (realFailures < input.minFailures) {
    return decide("keep", current,
      `only ${realFailures} real failures observed; loosening needs at least ${input.minFailures} (min_failures), and because a loosening must have zero misses, ${needText(input.recallTarget)} for the recall lower bound to reach ${input.recallTarget}`);
  }
  const best = pickFewest(looser, defaults);
  const bound = lb(best) ?? 0;
  if (bound < input.recallTarget) {
    return {
      ...decide("keep", current,
        `recall lower bound ${bound.toFixed(3)} over ${realFailures} real failures is below the target ${input.recallTarget}; a loosening must have zero misses, so it needs ${needText(input.recallTarget)}`),
      recallLb95: bound,
    };
  }
  return decide("loosen", best,
    `${fmt(best.gate)} selects ${current.selected - best.selected} fewer tests and still catches all ${realFailures} real failures (recall lower bound ${bound.toFixed(3)})`);
}
