import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { keyFor, memoryStore, seedRun, seedSelectorRun } from "./helpers.js";

const S = "tests/m.test.ts";
const names = ["missed", "caught", "flaky", "quarantined", "passing"];

describe("flaker_v1 selector views", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = await memoryStore();
    await store.insertCommitChanges("H", [
      { filePath: "src/b.ts", changeType: "modified", additions: 1, deletions: 0 },
      { filePath: "src/a.ts", changeType: "modified", additions: 1, deletions: 0 },
    ]);
    // The full run on H: four failures, one pass.
    await seedRun(store, { id: 10, commitSha: "H", daysAgo: 1, results: names.map((n) => ({
      suite: S, testName: n, status: n === "passing" ? "passed" : "failed",
    })) });
    // History that makes "flaky" flaky: a retried pass on another commit.
    await seedRun(store, { id: 9, commitSha: "G", daysAgo: 2, results: [
      { suite: S, testName: "flaky", status: "passed", retryCount: 1 },
    ] });
    await store.addQuarantine({ suite: S, testName: "quarantined" }, "manual");
  });
  afterEach(async () => {
    await store.close();
  });

  it("misses: unselected real failures in a full run on head_sha, minus flaky and quarantined", async () => {
    const k = async (n: string) => keyFor(store, S, n);
    await seedSelectorRun(store, { id: "sr1", headSha: "H", tests: [
      { testKey: await k("missed"), file: S, titlePath: ["missed"], reason: "below", selected: false, score: 0.4 },
      { testKey: await k("caught"), file: S, titlePath: ["caught"], reason: "scored", selected: true, score: 3 },
      { testKey: await k("flaky"), file: S, titlePath: ["flaky"], reason: "below", selected: false },
      { testKey: await k("quarantined"), file: S, titlePath: ["quarantined"], reason: "quarantined", selected: false },
      { testKey: await k("passing"), file: S, titlePath: ["passing"], reason: "below", selected: false },
      { testKey: null, file: S, titlePath: ["unknown"], reason: "below", selected: false },
    ] });
    const rows = await store.raw<{ test_key: string; head_sha: string; ci_run_id: bigint; reason: string; changed_files: string }>(
      `SELECT test_key, head_sha, ci_run_id, reason, changed_files FROM flaker_v1.misses`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].test_key).toBe(await k("missed"));
    expect(Number(rows[0].ci_run_id)).toBe(10);
    expect(rows[0].reason).toBe("below");
    expect(JSON.parse(rows[0].changed_files)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("misses: one row per verdict when the commit has several failing full runs", async () => {
    await seedRun(store, { id: 11, commitSha: "H", daysAgo: 1, results: names.map((n) => ({
      suite: S, testName: n, status: n === "passing" ? "passed" : "failed",
    })) });
    await seedSelectorRun(store, { id: "sr4", headSha: "H", tests: [
      { testKey: await keyFor(store, S, "missed"), file: S, titlePath: ["missed"], reason: "below", selected: false },
    ] });
    const rows = await store.raw<{ ci_run_id: bigint }>(`SELECT ci_run_id FROM flaker_v1.misses`);
    expect(rows.map((r) => Number(r.ci_run_id))).toEqual([10]);
  });

  it("misses: a mutation selector run is not scored against real full runs", async () => {
    await seedSelectorRun(store, { id: "sr5", headSha: "H", source: "mutation", tests: [
      { testKey: await keyFor(store, S, "missed"), file: S, titlePath: ["missed"], reason: "below", selected: false },
    ] });
    expect(await store.raw(`SELECT * FROM flaker_v1.misses`)).toEqual([]);
  });

  it("misses: a mutation full run is not ground truth", async () => {
    await store.insertCommitChanges("M", [{ filePath: "src/a.ts", changeType: "modified", additions: 1, deletions: 0 }]);
    await seedRun(store, { id: 12, commitSha: "M", daysAgo: 1, source: "mutation", results: names.map((n) => ({
      suite: S, testName: n, status: "failed",
    })) });
    await seedSelectorRun(store, { id: "sr6", headSha: "M", tests: [
      { testKey: await keyFor(store, S, "missed"), file: S, titlePath: ["missed"], reason: "below", selected: false },
    ] });
    expect(await store.raw(`SELECT * FROM flaker_v1.misses`)).toEqual([]);
  });

  it("misses: nothing for a head without a full run", async () => {
    await seedSelectorRun(store, { id: "sr2", headSha: "NOFULL", tests: [
      { testKey: await keyFor(store, S, "missed"), file: S, titlePath: ["missed"], reason: "below", selected: false },
    ] });
    const rows = await store.raw(`SELECT * FROM flaker_v1.misses WHERE head_sha = 'NOFULL'`);
    expect(rows).toEqual([]);
  });

  it("selector_verdicts and gate_calibration expose the stored rows", async () => {
    await seedSelectorRun(store, { id: "sr3", headSha: "H", tests: [
      { testKey: null, file: S, titlePath: ["x"], reason: "missing", selected: true },
    ] });
    await store.raw(
      `INSERT INTO gate_calibrations VALUES ('jev', ?, 1.5, 0.5, 1.0, 3, 2, 0.34, 'tighten', 'r')`,
      [new Date()],
    );
    const v = await store.raw<{ selector: string; reason: string; test_key: string | null }>(
      `SELECT selector, reason, test_key FROM flaker_v1.selector_verdicts WHERE selector_run_id = 'sr3'`,
    );
    expect(v).toEqual([{ selector: "jev", reason: "missing", test_key: null }]);
    const g = await store.raw<{ decision: string; cutoff: number }>(
      `SELECT decision, cutoff FROM flaker_v1.gate_calibration`,
    );
    expect(g).toEqual([{ decision: "tighten", cutoff: 1.5 }]);
  });

  it("selector_runs.imported_at defaults to naive UTC whatever the session time zone", async () => {
    await store.raw(`SET TimeZone = 'Asia/Tokyo'`);
    await seedSelectorRun(store, { id: "tz", headSha: "H", tests: [] });
    const [row] = await store.raw<{ imported_at: Date }>(
      `SELECT imported_at FROM selector_runs WHERE selector_run_id = 'tz'`,
    );
    expect(Math.abs(row.imported_at.getTime() - Date.now())).toBeLessThan(60_000);
  });
});
