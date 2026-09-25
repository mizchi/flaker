import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { isBroken, readCoFailuresWindow, readFlakyWindow } from "../../src/cli/datasets/windowed.js";
import { readDataset } from "../../src/cli/datasets/read.js";
import { DAY, keyFor, memoryStore, seedRun } from "./helpers.js";

const S = "tests/w.test.ts";

describe("windowed flaker_v1 facts", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = await memoryStore({ flakyWindowDays: 14 });
    // ci: a flip on c1 (flaky), a plain regression on every run (broken)
    await seedRun(store, { id: 1, commitSha: "c1", daysAgo: 2, results: [
      { suite: S, testName: "flip", status: "failed" }, { suite: S, testName: "broken", status: "failed" },
    ] });
    await seedRun(store, { id: 2, commitSha: "c1", daysAgo: 2, results: [
      { suite: S, testName: "flip", status: "passed" }, { suite: S, testName: "broken", status: "failed" },
    ] });
    // local only, 20 days ago: outside the 14-day window
    await seedRun(store, { id: 3, commitSha: "c0", daysAgo: 20, source: "local", results: [
      { suite: S, testName: "old-local", status: "flaky" },
    ] });
    await store.insertCommitChanges("c1", [{ filePath: "src/a.ts", changeType: "modified", additions: 1, deletions: 0 }]);
  });
  afterEach(async () => {
    await store.close();
  });

  it("equals the view at the configured window", async () => {
    const view = await readDataset(store, "flaky");
    const macro = await readFlakyWindow(store, { windowDays: 14 });
    expect(macro.map((r) => r.test_key).sort()).toEqual(view.map((r) => r.test_key as string).sort());
  });

  it("takes a window and a fixed now, and can keep CI runs only", async () => {
    const wide = await readFlakyWindow(store, { windowDays: 30 });
    expect(wide.map((r) => r.test_key)).toContain(await keyFor(store, S, "old-local"));
    const ci = await readFlakyWindow(store, { windowDays: 30, ciOnly: true });
    expect(ci.map((r) => r.test_key)).not.toContain(await keyFor(store, S, "old-local"));
    const past = await readFlakyWindow(store, { windowDays: 5, now: new Date(Date.now() - 18 * DAY) });
    expect(past.map((r) => r.test_key)).toEqual([await keyFor(store, S, "old-local")]);
  });

  it("marks broken apart from flaky", async () => {
    const rows = await readFlakyWindow(store, { windowDays: 14 });
    const byKey = new Map(rows.map((r) => [r.test_key, r]));
    const broken = byKey.get(await keyFor(store, S, "broken"))!;
    const flip = byKey.get(await keyFor(store, S, "flip"))!;
    expect(isBroken(broken)).toBe(true);
    expect(broken.is_flaky).toBe(false);
    expect(isBroken(flip)).toBe(false);
    expect(flip.is_flaky).toBe(true);
  });

  it("reads co-failures over a window", async () => {
    const rows = await readCoFailuresWindow(store, { windowDays: 14 });
    expect(rows.map((r) => r.changed_file)).toEqual(["src/a.ts", "src/a.ts"]);
    expect(await readCoFailuresWindow(store, { windowDays: 1 })).toEqual([]);
  });
});
