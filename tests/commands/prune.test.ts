import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { minimumRetentionDays, runPrune, formatPruneReport } from "../../src/cli/commands/prune/prune.js";
import { DAY, memoryStore, seedRun, seedSelectorRun } from "../datasets/helpers.js";

const SETTINGS = { flakyWindowDays: 14, coFailureWindowDays: 90 };

async function count(store: DuckDBStore, table: string): Promise<number> {
  const [row] = await store.raw<{ n: number }>(`SELECT COUNT(*)::INTEGER AS n FROM ${table}`);
  return row.n;
}

describe("flaker prune", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = await memoryStore();
    // One old run (200 days) and one kept run (10 days) on different commits.
    await seedRun(store, { id: 1, commitSha: "old", daysAgo: 200, results: [{ suite: "a.test.ts", testName: "a", status: "failed" }] });
    await seedRun(store, { id: 2, commitSha: "new", daysAgo: 10, results: [{ suite: "a.test.ts", testName: "a", status: "passed" }] });
    // A commit named by both an old and a kept run keeps its changes.
    await seedRun(store, { id: 3, commitSha: "shared", daysAgo: 200, results: [] });
    await seedRun(store, { id: 4, commitSha: "shared", daysAgo: 5, results: [] });
    for (const sha of ["old", "new", "shared", "unrun"]) {
      await store.insertCommitChanges(sha, [{ filePath: "src/a.ts", changeType: "modified", additions: 1, deletions: 0 }]);
    }
    await store.recordCollectedArtifact({ workflowRunId: 1, adapterType: "vitest", artifactName: "r" });
    await store.recordSamplingRun({
      commandKind: "sample", strategy: "random", candidateCount: 1, selectedCount: 1,
      createdAt: new Date(Date.now() - 200 * DAY),
    });
    const sampled = await store.raw<{ id: bigint }>(`SELECT id FROM sampling_runs`);
    await store.raw(
      `INSERT INTO sampling_run_tests (sampling_run_id, ordinal, suite, test_name) VALUES (?, 0, 'a.test.ts', 'a')`,
      [sampled[0].id],
    );
    const verdict = { testKey: null, file: "a.test.ts", titlePath: ["a"], reason: "r", selected: true };
    await seedSelectorRun(store, { id: "sel-old", headSha: "old", createdAt: new Date(Date.now() - 200 * DAY), tests: [verdict] });
    await seedSelectorRun(store, { id: "sel-new", headSha: "new", createdAt: new Date(Date.now() - 1 * DAY), tests: [verdict] });
    for (const daysAgo of [300, 200]) {
      await store.raw(
        `INSERT INTO gate_calibrations VALUES ('jev', ?, 2, 0.5, 1, 1, 0, NULL, 'keep', 'r')`,
        [new Date(Date.now() - daysAgo * DAY)],
      );
    }
    await store.addQuarantine({ suite: "a.test.ts", testName: "a" }, "manual");
    for (const [id, daysAgo] of [[1, 200], [2, 5]]) {
      await store.raw(
        `INSERT INTO mutation_trials VALUES (?, ?, 'old', 'src/a.ts', 1, 'compare', '===', '!==', 1, ?)`,
        [id, `m${id}`, new Date(Date.now() - daysAgo * DAY)],
      );
      await store.raw(`INSERT INTO mutation_failures VALUES (?, 'k')`, [id]);
    }
  });

  afterEach(async () => {
    await store.close();
  });

  const EXPECTED = {
    workflow_runs: 2,
    test_results: 1,
    collected_artifacts: 1,
    commit_changes: 1,
    sampling_runs: 1,
    sampling_run_tests: 1,
    selector_runs: 1,
    selector_run_tests: 1,
    gate_calibrations: 1,
    mutation_trials: 1,
    mutation_failures: 1,
  };

  it("--dry-run reports what it would remove and removes nothing", async () => {
    const before = await count(store, "workflow_runs");
    const result = await runPrune({ store, olderThanDays: 120, settings: SETTINGS, dryRun: true });
    expect(result.removed).toEqual(EXPECTED);
    expect(result.dry_run).toBe(true);
    expect(await count(store, "workflow_runs")).toBe(before);
    expect(await count(store, "gate_calibrations")).toBe(2);
    expect(formatPruneReport(result)).toMatch(/Would remove[\s\S]*workflow_runs\s+2[\s\S]*Dry run/);
  });

  it("removes old history consistently and keeps state and the latest calibration", async () => {
    const result = await runPrune({ store, olderThanDays: 120, settings: SETTINGS, dryRun: false });
    expect(result.removed).toEqual(EXPECTED);

    expect((await store.raw<{ id: bigint }>(`SELECT id FROM workflow_runs ORDER BY id`)).map((r) => Number(r.id))).toEqual([2, 4]);
    expect(await count(store, "test_results")).toBe(1);
    expect(await count(store, "collected_artifacts")).toBe(0);
    expect((await store.raw<{ commit_sha: string }>(`SELECT commit_sha FROM commit_changes ORDER BY commit_sha`)).map((r) => r.commit_sha))
      .toEqual(["new", "shared", "unrun"]);
    expect(await count(store, "sampling_run_tests")).toBe(0);
    expect((await store.raw<{ id: string }>(`SELECT selector_run_id AS id FROM selector_runs`)).map((r) => r.id)).toEqual(["sel-new"]);
    expect(await count(store, "selector_run_tests")).toBe(1);
    expect(await count(store, "gate_calibrations")).toBe(1);
    expect(await count(store, "quarantined_test_identities")).toBe(1);
    expect(await count(store, "mutation_trials")).toBe(1);
    expect(await count(store, "mutation_failures")).toBe(1);
    // No orphans left behind for the views to trip over.
    expect(await count(store, "flaker_v1.results")).toBe(1);

    // A second prune finds nothing more.
    const again = await runPrune({ store, olderThanDays: 120, settings: SETTINGS, dryRun: false });
    expect(Object.values(again.removed).every((n) => n === 0)).toBe(true);
  });

  it("refuses a window shorter than what the flaky, co-failure and calibration windows need", async () => {
    expect(minimumRetentionDays(SETTINGS)).toBe(104);
    expect(minimumRetentionDays({ flakyWindowDays: 30, coFailureWindowDays: 180 })).toBe(210);
    await expect(runPrune({ store, olderThanDays: 103, settings: SETTINGS, dryRun: true })).rejects.toThrow(/at least 104 days/);
    expect(await count(store, "workflow_runs")).toBe(4);
  });
});
