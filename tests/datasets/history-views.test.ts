import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { keyFor, memoryStore, seedRun } from "./helpers.js";

const S = "tests/h.test.ts";

describe("flaker_v1 history views", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = await memoryStore();
  });
  afterEach(async () => {
    await store.close();
  });

  it("flaky: needs a retry or a same-commit flip; a plain regression is not flaky", async () => {
    await seedRun(store, { id: 1, commitSha: "c1", daysAgo: 5, results: [
      { suite: S, testName: "retry", status: "passed", retryCount: 1 },
      { suite: S, testName: "regression", status: "failed" },
      { suite: S, testName: "flip", status: "failed" },
    ] });
    await seedRun(store, { id: 2, commitSha: "c1", daysAgo: 5, results: [
      { suite: S, testName: "flip", status: "passed" },
    ] });
    await seedRun(store, { id: 3, commitSha: "c2", daysAgo: 4, results: [
      { suite: S, testName: "retry", status: "passed" },
      { suite: S, testName: "regression", status: "failed" },
    ] });
    await seedRun(store, { id: 4, commitSha: "c0", daysAgo: 20, results: [
      { suite: S, testName: "old", status: "passed", retryCount: 1 },
    ] });
    const rows = await store.raw<{ test_name: string; runs: number; failures: number; flaky_rate: number; is_flaky: boolean; window_days: number }>(`
      SELECT t.test_name, f.runs, f.failures, f.flaky_rate, f.is_flaky, f.window_days
      FROM flaker_v1.flaky f JOIN flaker_v1.tests t USING (test_key)
      ORDER BY t.test_name`);
    expect(rows).toEqual([
      { test_name: "flip", runs: 2, failures: 1, flaky_rate: 0.5, is_flaky: true, window_days: 14 },
      { test_name: "regression", runs: 2, failures: 2, flaky_rate: 0, is_flaky: false, window_days: 14 },
      { test_name: "retry", runs: 2, failures: 1, flaky_rate: 0.5, is_flaky: true, window_days: 14 },
    ]);
  });

  it("flaky: flaky_rate counts retried and same-commit flipped outcomes only", async () => {
    await store.close();
    store = await memoryStore({ flakyThresholdRatio: 0.3 });
    // Retried once, then a real regression on four later commits.
    await seedRun(store, { id: 1, commitSha: "c1", daysAgo: 6, results: [
      { suite: S, testName: "regressed", status: "passed", retryCount: 1 },
    ] });
    for (let i = 2; i <= 5; i++) {
      await seedRun(store, { id: i, commitSha: `c${i}`, daysAgo: 6 - i, results: [
        { suite: S, testName: "regressed", status: "failed" },
      ] });
    }
    const [row] = await store.raw<{ failures: number; flaky_rate: number; is_flaky: boolean }>(
      `SELECT failures, flaky_rate, is_flaky FROM flaker_v1.flaky`,
    );
    expect(row).toEqual({ failures: 5, flaky_rate: 0.2, is_flaky: false });
  });

  it("flaky and co_failures ignore mutation runs", async () => {
    await store.insertCommitChanges("m1", [{ filePath: "src/x.ts", changeType: "modified", additions: 1, deletions: 0 }]);
    await seedRun(store, { id: 1, commitSha: "m1", daysAgo: 2, source: "mutation", results: [
      { suite: S, testName: "t", status: "passed", retryCount: 1 },
      { suite: S, testName: "u", status: "failed" },
    ] });
    await seedRun(store, { id: 2, commitSha: "c2", daysAgo: 1, results: [
      { suite: S, testName: "t", status: "passed" },
      { suite: S, testName: "u", status: "passed" },
    ] });
    const flaky = await store.raw<{ runs: number; is_flaky: boolean }>(`SELECT runs, is_flaky FROM flaker_v1.flaky`);
    expect(flaky).toEqual([{ runs: 1, is_flaky: false }, { runs: 1, is_flaky: false }]);
    const co = await store.raw(`SELECT * FROM flaker_v1.co_failures`);
    expect(co).toEqual([]);
  });

  it("quarantine: source is auto for plan-applied entries, manual otherwise", async () => {
    await seedRun(store, { id: 1, commitSha: "c1", daysAgo: 1, results: [
      { suite: S, testName: "q1", status: "failed" },
      { suite: S, testName: "q2", status: "failed" },
    ] });
    await store.addQuarantine({ suite: S, testName: "q1" }, "manual");
    await store.addQuarantine({ suite: S, testName: "q2" }, "plan:flaky");
    const rows = await store.raw<{ test_key: string; source: string; since: Date | null }>(
      `SELECT test_key, source, since FROM flaker_v1.quarantine`,
    );
    const bySource = Object.fromEntries(rows.map((r) => [r.test_key, r.source]));
    expect(bySource[await keyFor(store, S, "q1")]).toBe("manual");
    expect(bySource[await keyFor(store, S, "q2")]).toBe("auto");
    expect(rows.every((r) => r.since instanceof Date)).toBe(true);
  });

  it("co_failures: per changed file and test, over distinct commits", async () => {
    for (const [i, sha, status] of [[1, "s1", "failed"], [2, "s2", "failed"], [3, "s3", "passed"]] as const) {
      await store.insertCommitChanges(sha, [{ filePath: "src/auth.ts", changeType: "modified", additions: 1, deletions: 0 }]);
      await seedRun(store, { id: i, commitSha: sha, daysAgo: 4 - i, results: [
        { suite: "tests/login.test.ts", testName: "login", status },
      ] });
    }
    const rows = await store.raw<Record<string, unknown>>(
      `SELECT changed_file, co_failures, changes, strength, window_days FROM flaker_v1.co_failures`,
    );
    expect(rows).toEqual([
      { changed_file: "src/auth.ts", co_failures: 2, changes: 3, strength: 0.6667, window_days: 90 },
    ]);
  });
});
