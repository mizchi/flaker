// src/cli/commands/calibrate/selector.ts
import { DEFAULT_CUTOFF, DEFAULT_UNSURE_BELOW, DEFAULT_UNSURE_MARGIN } from "jev-test-filter/gate";
import type { MetricStore } from "../../storage/types.js";
import type { SelectorConfig } from "../../config.js";
import { resolveSelectorTestKeys } from "../../selector/store.js";
import { loadCalibrationRecords, type UnmatchedFailure } from "../../selector/ground-truth.js";
import { calibrateGate, type CalibrationDecision } from "../../selector/calibrate-core.js";
import type { GateValues } from "../../selector/replay.js";
import { FLAKER_V1_SCHEMAS, type FlakerV1GateCalibrationRow } from "../../contracts/flaker-v1-datasets.js";
import { normalizeRow } from "../../datasets/serialize.js";

/** jev's own defaults, single-sourced from jev-test-filter/gate. */
export const JEV_DEFAULT_GATE: GateValues = {
  cutoff: DEFAULT_CUTOFF,
  unsure_below: DEFAULT_UNSURE_BELOW,
  unsure_margin: DEFAULT_UNSURE_MARGIN,
};

export async function latestGateCalibration(
  store: MetricStore,
  selector: string,
): Promise<FlakerV1GateCalibrationRow | null> {
  const [row] = await store.raw<Record<string, unknown>>(
    `SELECT * FROM flaker_v1.gate_calibration WHERE selector = ? ORDER BY calibrated_at DESC LIMIT 1`,
    [selector],
  );
  return row ? (normalizeRow(row, FLAKER_V1_SCHEMAS.gate_calibration) as unknown as FlakerV1GateCalibrationRow) : null;
}

export interface SelectorCalibrationResult {
  selector: string;
  calibratedAt: string;
  decision: CalibrationDecision;
  withoutFullRun: number;
  unmatched: UnmatchedFailure[];
  written: boolean;
}

export async function runSelectorCalibration(opts: {
  store: MetricStore;
  selector: SelectorConfig;
  windowDays: number;
  dryRun: boolean;
  now?: Date;
}): Promise<SelectorCalibrationResult> {
  const now = opts.now ?? new Date();
  const name = opts.selector.type;
  await resolveSelectorTestKeys(opts.store);
  const latest = await latestGateCalibration(opts.store, name);
  const current: GateValues = latest
    ? { cutoff: latest.cutoff, unsure_below: latest.unsure_below, unsure_margin: latest.unsure_margin }
    : JEV_DEFAULT_GATE;
  const loaded = await loadCalibrationRecords(opts.store, {
    selector: name,
    since: new Date(now.getTime() - opts.windowDays * 86_400_000),
  });
  const decision = calibrateGate({
    records: loaded.records,
    current,
    defaults: JEV_DEFAULT_GATE,
    recallTarget: opts.selector.recall_target,
    minFailures: opts.selector.min_failures,
  });
  if (!opts.dryRun) {
    await opts.store.raw(
      `INSERT INTO gate_calibrations (selector, calibrated_at, cutoff, unsure_below, unsure_margin, records, real_failures, recall_lb95, decision, rationale)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name, now, decision.gate.cutoff, decision.gate.unsure_below, decision.gate.unsure_margin,
        decision.records, decision.realFailures, decision.recallLb95, decision.decision, decision.rationale,
      ],
    );
  }
  return {
    selector: name, calibratedAt: now.toISOString(), decision,
    withoutFullRun: loaded.withoutFullRun, unmatched: loaded.unmatched, written: !opts.dryRun,
  };
}

const g = (v: GateValues) => `cutoff ${v.cutoff} / unsure_below ${v.unsure_below} / unsure_margin ${v.unsure_margin}`;

export function formatSelectorCalibration(r: SelectorCalibrationResult): string {
  const d = r.decision;
  const lines = [
    `Selector gate calibration (${r.selector})`,
    `  records with a full run:  ${d.records} (${r.withoutFullRun} without one)`,
    `  real failures:            ${d.realFailures}`,
    `  current gate:             ${g(d.current.gate)} → selected ${d.current.selected}, missed ${d.current.missed}`,
    `  decision:                 ${d.decision} → ${g(d.gate)} (selected ${d.adopted.selected}, missed ${d.adopted.missed})`,
    `  recall lower bound (95%): ${d.recallLb95 === null ? "n/a" : d.recallLb95.toFixed(3)}`,
    `  rationale:                ${d.rationale}`,
  ];
  if (d.byDigest.length > 1) {
    lines.push("  by context digest:");
    for (const b of d.byDigest) {
      lines.push(`    ${b.contextDigest ?? "(none)"}  records ${b.records}  failures ${b.failures}  missed under current ${b.missedUnderCurrent}`);
    }
  }
  if (r.unmatched.length > 0) {
    lines.push(`  unmatched failures:       ${r.unmatched.length} (not counted as misses)`);
    for (const u of r.unmatched.slice(0, 20)) lines.push(`    ${u.testKey} at ${u.headSha}`);
  }
  lines.push(r.written
    ? "Appended to gate_calibration. Run `flaker export --projection jev-context -o .flaker/context.json` to hand it to jev-test-filter."
    : "Dry run: gate_calibration was not changed.");
  return lines.join("\n");
}
