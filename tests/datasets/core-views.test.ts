import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { DAY, memoryStore, seedRun } from "./helpers.js";

const ten = Array.from({ length: 10 }, (_, i) => ({
  suite: "tests/x.test.ts", testName: `t${i}`, status: "passed",
}));

describe("flaker_v1 core views", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = await memoryStore({ fullByLane: { "full-batch": true, sampled: false } });
  });
  afterEach(async () => {
    await store.close();
  });

  it("tests: one row per test_key, file and title_path, falling back to [test_name]", async () => {
    await seedRun(store, { id: 1, commitSha: "a", daysAgo: 2, results: [
      { suite: "tests/a.test.ts", testName: "A works", titlePath: ["A", "works"], status: "passed" },
      { suite: "tests/b.test.ts", testName: "legacy name", status: "passed" },
    ] });
    await seedRun(store, { id: 2, commitSha: "b", daysAgo: 1, results: [
      { suite: "tests/a.test.ts", testName: "A works", titlePath: ["A", "works"], status: "failed" },
    ] });
    const rows = await store.raw<{ file: string; title_path: string; first_seen_at: Date; last_seen_at: Date }>(
      `SELECT file, title_path, first_seen_at, last_seen_at FROM flaker_v1.tests ORDER BY file`,
    );
    expect(rows.map((r) => [r.file, JSON.parse(r.title_path)])).toEqual([
      ["tests/a.test.ts", ["A", "works"]],
      ["tests/b.test.ts", ["legacy name"]],
    ]);
    expect(rows[0].first_seen_at.getTime()).toBeLessThan(rows[0].last_seen_at.getTime());
  });

  it("tests: rows with the same created_at resolve to the latest stored row", async () => {
    const at = new Date(Date.now() - DAY);
    for (const [id, title] of [[1, "old"], [2, "new"]] as const) {
      await store.insertWorkflowRun({
        id, repo: "o/r", branch: "main", commitSha: `c${id}`, event: "push", source: "ci",
        status: "completed", createdAt: at, durationMs: 1, workflowName: "ci", lane: null,
      });
      await store.insertTestResults([{
        workflowRunId: id, suite: "tests/t.test.ts", testName: "t", status: "passed", durationMs: 1,
        retryCount: 0, errorMessage: null, commitSha: `c${id}`, variant: null, titlePath: [title, "t"], createdAt: at,
      }]);
    }
    const [row] = await store.raw<{ title_path: string }>(`SELECT title_path FROM flaker_v1.tests`);
    expect(JSON.parse(row.title_path)).toEqual(["new", "t"]);
  });

  it("runs: is_full from the lane config, else >= 95% of the workflow's recent tests", async () => {
    await seedRun(store, { id: 1, commitSha: "full", daysAgo: 3, results: ten });
    await seedRun(store, { id: 2, commitSha: "part", daysAgo: 2, results: ten.slice(0, 3) });
    await seedRun(store, { id: 3, commitSha: "lane-full", daysAgo: 1, lane: "full-batch", results: ten.slice(0, 1) });
    await seedRun(store, { id: 4, commitSha: "lane-sampled", daysAgo: 1, lane: "sampled", results: ten });
    await seedRun(store, { id: 5, commitSha: "other-wf", daysAgo: 1, workflowName: "e2e", results: [
      { suite: "e2e/y.spec.ts", testName: "y", status: "passed" },
    ] });
    const rows = await store.raw<{ commit_sha: string; is_full: boolean }>(
      `SELECT commit_sha, is_full FROM flaker_v1.runs ORDER BY run_id`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.commit_sha, r.is_full]))).toEqual({
      full: true, part: false, "lane-full": true, "lane-sampled": false, "other-wf": true,
    });
  });

  it("runs: renaming half the tests does not make the next full run partial", async () => {
    const renamed = ten.map((t, i) => (i < 5 ? t : { ...t, testName: `renamed${i}` }));
    await seedRun(store, { id: 1, commitSha: "before", daysAgo: 3, results: ten });
    await seedRun(store, { id: 2, commitSha: "after", daysAgo: 2, results: renamed });
    await seedRun(store, { id: 3, commitSha: "part", daysAgo: 1, results: renamed.slice(0, 5) });
    const rows = await store.raw<{ commit_sha: string; is_full: boolean }>(
      `SELECT commit_sha, is_full FROM flaker_v1.runs ORDER BY run_id`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.commit_sha, r.is_full]))).toEqual({
      before: true, after: true, part: false,
    });
  });

  it("runs: a run outside the window does not count toward the largest run", async () => {
    await seedRun(store, { id: 1, commitSha: "old-big", daysAgo: 30, results: [
      ...ten, ...ten.map((t) => ({ ...t, testName: `${t.testName}-extra` })),
    ] });
    await seedRun(store, { id: 2, commitSha: "now", daysAgo: 1, results: ten });
    const [row] = await store.raw<{ is_full: boolean }>(`SELECT is_full FROM flaker_v1.runs WHERE run_id = 2`);
    expect(row.is_full).toBe(true);
  });

  it("runs: stays fast at 200 runs x 50 tests", async () => {
    const fifty = Array.from({ length: 50 }, (_, i) => ({ suite: "tests/s.test.ts", testName: `s${i}`, status: "passed" }));
    for (let id = 1; id <= 200; id++) {
      await seedRun(store, { id, commitSha: `c${id}`, daysAgo: (200 - id) / 20, results: id % 4 === 0 ? fifty.slice(0, 10) : fifty });
    }
    const started = performance.now();
    const rows = await store.raw<{ is_full: boolean }>(`SELECT is_full FROM flaker_v1.runs`);
    const elapsed = performance.now() - started;
    expect(rows.filter((r) => r.is_full)).toHaveLength(150);
    expect(elapsed).toBeLessThan(1000);
  });

  it("runs: a run with no results is never full, and source follows the local-event rule", async () => {
    await store.insertWorkflowRun({
      id: 7, repo: "o/r", branch: "main", commitSha: "empty", event: "local-import",
      status: "completed", createdAt: new Date(), durationMs: 1,
    });
    const [row] = await store.raw<{ is_full: boolean; source: string }>(
      `SELECT is_full, source FROM flaker_v1.runs WHERE run_id = 7`,
    );
    expect(row).toEqual({ is_full: false, source: "local" });
  });

  it("runs: is_full is false, not null, when the results have no timestamps", async () => {
    await seedRun(store, { id: 8, commitSha: "no-time", daysAgo: 1, results: ten });
    await store.raw(`UPDATE test_results SET created_at = NULL WHERE workflow_run_id = 8`);
    const [row] = await store.raw<{ is_full: boolean | null }>(`SELECT is_full FROM flaker_v1.runs WHERE run_id = 8`);
    expect(row.is_full).toBe(false);
  });

  it("results: one row per stored result keyed by test_key", async () => {
    await seedRun(store, { id: 1, commitSha: "a", daysAgo: 1, results: ten.slice(0, 2) });
    const rows = await store.raw<{ n: number; keyed: number }>(
      `SELECT COUNT(*)::INTEGER AS n, COUNT(test_key)::INTEGER AS keyed FROM flaker_v1.results`,
    );
    expect(rows[0]).toEqual({ n: 2, keyed: 2 });
  });
});
