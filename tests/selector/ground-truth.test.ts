// tests/selector/ground-truth.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { loadCalibrationRecords } from "../../src/cli/selector/ground-truth.js";
import { keyFor, memoryStore, seedRun, seedSelectorRun } from "../datasets/helpers.js";

const S = "tests/g.test.ts";

describe("loadCalibrationRecords", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = await memoryStore();
    await seedRun(store, { id: 1, commitSha: "H", daysAgo: 1, results: [
      { suite: S, testName: "known", status: "failed" },
      { suite: S, testName: "unknown-to-selector", status: "failed" },
      { suite: S, testName: "ok", status: "passed" },
    ] });
  });
  afterEach(async () => {
    await store.close();
  });

  it("joins verdicts to the full run on head_sha; unmatched failures are listed, not counted", async () => {
    await seedSelectorRun(store, { id: "sr1", headSha: "H", contextDigest: "sha256:aa", tests: [
      { testKey: await keyFor(store, S, "known"), file: S, titlePath: ["known"], reason: "below", selected: false, score: 0.4, confidence: 0.9 },
      { testKey: await keyFor(store, S, "ok"), file: S, titlePath: ["ok"], reason: "scored", selected: true, score: 3, confidence: 0.9 },
    ] });
    await seedSelectorRun(store, { id: "sr2", headSha: "NOFULL", tests: [] });
    const loaded = await loadCalibrationRecords(store, { selector: "jev", since: new Date(0) });
    expect(loaded.withoutFullRun).toBe(1);
    expect(loaded.records).toHaveLength(1);
    expect(loaded.records[0]).toMatchObject({
      selectorRunId: "sr1", source: "real", contextDigest: "sha256:aa",
      failures: [await keyFor(store, S, "known")],
    });
    expect(loaded.records[0].verdicts).toHaveLength(2);
    expect(loaded.unmatched).toEqual([
      { selectorRunId: "sr1", headSha: "H", testKey: await keyFor(store, S, "unknown-to-selector") },
    ]);
  });

  it("does not score a mutation record against a real full run", async () => {
    await seedSelectorRun(store, { id: "m1", headSha: "H", source: "mutation", tests: [
      { testKey: await keyFor(store, S, "known"), file: S, titlePath: ["known"], reason: "below", selected: false, score: 0.4, confidence: 0.9 },
    ] });
    const loaded = await loadCalibrationRecords(store, { selector: "jev", since: new Date(0) });
    expect(loaded.records).toEqual([]);
    expect(loaded.unmatched).toEqual([]);
    expect(loaded.mutation).toEqual({ records: 0, failures: 0, withoutTrial: 1, unmatched: 0 });
  });

  it("scores a mutation record against the tests its trial killed, the latest record per trial", async () => {
    const known = await keyFor(store, S, "known");
    const ok = await keyFor(store, S, "ok");
    await store.raw(
      `INSERT INTO mutation_trials VALUES (7, 'M', 'H', 'src/a.ts', 3, 'compare', '===', '!==', 3, ?)`,
      [new Date()],
    );
    for (const id of [known, ok, "not-a-verdict"]) {
      await store.raw(`INSERT INTO mutation_failures VALUES (7, ?)`, [id]);
    }
    await store.addQuarantine({ suite: S, testName: "ok" }, "manual");
    for (const [i, id] of ["m-old", "m-new"].entries()) {
      await seedSelectorRun(store, { id, headSha: "M", source: "mutation", createdAt: new Date(Date.now() - (2 - i) * 60_000), tests: [
        { testKey: known, file: S, titlePath: ["known"], reason: "below", selected: false, score: 0.4, confidence: 0.9 },
        { testKey: ok, file: S, titlePath: ["ok"], reason: "quarantined", selected: false },
      ] });
    }
    const loaded = await loadCalibrationRecords(store, { selector: "jev", since: new Date(0) });
    const mutation = loaded.records.filter((r) => r.source === "mutation");
    // The quarantined kill is not ground truth; a kill no verdict names is unmatched.
    expect(mutation).toEqual([expect.objectContaining({ selectorRunId: "m-new", failures: [known] })]);
    expect(loaded.mutation).toEqual({ records: 1, failures: 1, withoutTrial: 0, unmatched: 1 });

    const [row] = await store.raw<{ source: string; is_full: boolean; run_id: bigint }>(
      `SELECT source, is_full, run_id FROM flaker_v1.runs WHERE commit_sha = 'M'`,
    );
    expect(row).toMatchObject({ source: "mutation", is_full: true });
    expect(Number(row.run_id)).toBe(-7);
  });

  it("keeps one selector run per head, the latest, so one regression counts once", async () => {
    const known = await keyFor(store, S, "known");
    for (const [i, id] of ["old", "mid", "new"].entries()) {
      await seedSelectorRun(store, { id, headSha: "H", createdAt: new Date(Date.now() - (3 - i) * 60_000), tests: [
        { testKey: known, file: S, titlePath: ["known"], reason: "below", selected: false, score: 0.4, confidence: 0.9 },
      ] });
    }
    const loaded = await loadCalibrationRecords(store, { selector: "jev", since: new Date(0) });
    expect(loaded.records.map((r) => r.selectorRunId)).toEqual(["new"]);
    expect(loaded.records.flatMap((r) => r.failures)).toEqual([known]);
    expect(loaded.superseded).toBe(2);
  });
});
