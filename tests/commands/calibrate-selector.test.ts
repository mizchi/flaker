// tests/commands/calibrate-selector.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { DEFAULT_SELECTOR } from "../../src/cli/config.js";
import { latestGateCalibration, runSelectorCalibration } from "../../src/cli/commands/calibrate/selector.js";
import { keyFor, memoryStore, seedRun, seedSelectorRun } from "../datasets/helpers.js";

const S = "tests/c.test.ts";

describe("runSelectorCalibration", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = await memoryStore();
    await seedRun(store, { id: 1, commitSha: "H", daysAgo: 1, results: [
      { suite: S, testName: "regressed", status: "failed" },
      { suite: S, testName: "fine", status: "passed" },
    ] });
    await seedSelectorRun(store, { id: "sr1", headSha: "H", tests: [
      { testKey: await keyFor(store, S, "regressed"), file: S, titlePath: ["regressed"], reason: "below", selected: false, score: 1.2, confidence: 0.9 },
      { testKey: await keyFor(store, S, "fine"), file: S, titlePath: ["fine"], reason: "below", selected: false, score: 0.2, confidence: 0.9 },
    ] });
  });
  afterEach(async () => {
    await store.close();
  });

  it("appends a tighten row and uses it as the current gate next time", async () => {
    const first = await runSelectorCalibration({ store, selector: DEFAULT_SELECTOR, windowDays: 90, dryRun: false });
    expect(first.decision.decision).toBe("tighten");
    expect(first.written).toBe(true);
    const latest = await latestGateCalibration(store, "jev");
    expect(latest).toMatchObject({ cutoff: 1, decision: "tighten", records: 1, real_failures: 1 });
    // gate_calibrations is keyed by (selector, calibrated_at): give the second run its own instant.
    const second = await runSelectorCalibration({ store, selector: DEFAULT_SELECTOR, windowDays: 90, dryRun: false, now: new Date(Date.now() + 1000) });
    expect(second.decision.current.gate.cutoff).toBe(1);
    expect(second.decision.decision).toBe("keep");
  });

  it("--dry-run appends nothing", async () => {
    const r = await runSelectorCalibration({ store, selector: DEFAULT_SELECTOR, windowDays: 90, dryRun: true });
    expect(r.written).toBe(false);
    expect(await latestGateCalibration(store, "jev")).toBeNull();
  });

  it("retries a same-instant calibration one millisecond later instead of failing on the key", async () => {
    const now = new Date("2026-09-24T00:00:00.000Z");
    await runSelectorCalibration({ store, selector: DEFAULT_SELECTOR, windowDays: 3650, dryRun: false, now });
    const second = await runSelectorCalibration({ store, selector: DEFAULT_SELECTOR, windowDays: 3650, dryRun: false, now });
    expect(second.written).toBe(true);
    expect(second.calibratedAt).toBe("2026-09-24T00:00:00.001Z");
    const [row] = await store.raw<{ n: number }>(`SELECT COUNT(*)::INTEGER AS n FROM gate_calibrations`);
    expect(row.n).toBe(2);
  });
});
