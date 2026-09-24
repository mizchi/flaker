// tests/projections/registry.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { DEFAULT_SELECTOR } from "../../src/cli/config.js";
import { runProjection } from "../../src/cli/projections/index.js";
import { memoryStore, seedRun } from "../datasets/helpers.js";

describe("runProjection", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = await memoryStore();
  });
  afterEach(async () => {
    await store.close();
  });

  it("builds jev-context from the datasets", async () => {
    await seedRun(store, { id: 1, commitSha: "c", daysAgo: 1, results: [
      { suite: "tests/q.test.ts", testName: "q", titlePath: ["q"], status: "failed" },
    ] });
    await store.addQuarantine({ suite: "tests/q.test.ts", testName: "q" }, "manual");
    const ctx = await runProjection("jev-context", store, { selector: DEFAULT_SELECTOR, now: new Date("2026-09-24T00:00:00Z") });
    expect(ctx).toMatchObject({ version: 1, gate: null, skip: [{ file: "tests/q.test.ts", title_path: ["q"], reason: "quarantined" }], tests: [] });
  });

  it("rejects an unknown projection", async () => {
    await expect(runProjection("nope", store, { selector: DEFAULT_SELECTOR })).rejects.toThrow(/Unknown projection/);
  });
});
