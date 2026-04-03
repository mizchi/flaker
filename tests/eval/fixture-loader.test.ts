import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { generateFixture, type FixtureConfig } from "../../src/cli/eval/fixture-generator.js";
import { loadFixtureIntoStore } from "../../src/cli/eval/fixture-loader.js";

const config: FixtureConfig = {
  testCount: 20,
  commitCount: 10,
  flakyRate: 0.1,
  coFailureStrength: 0.8,
  filesPerCommit: 2,
  testsPerFile: 4,
  samplePercentage: 20,
  seed: 42,
};

describe("loadFixtureIntoStore", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("loads all workflow runs", async () => {
    const fixture = generateFixture(config);
    await loadFixtureIntoStore(store, fixture);

    const rows = await store.raw<{ cnt: number }>(
      "SELECT COUNT(*)::INTEGER AS cnt FROM workflow_runs",
    );
    expect(rows[0].cnt).toBe(10);
  });

  it("loads all test results", async () => {
    const fixture = generateFixture(config);
    await loadFixtureIntoStore(store, fixture);

    const rows = await store.raw<{ cnt: number }>(
      "SELECT COUNT(*)::INTEGER AS cnt FROM test_results",
    );
    expect(rows[0].cnt).toBe(200); // 10 commits * 20 tests
  });

  it("loads all commit changes", async () => {
    const fixture = generateFixture(config);
    await loadFixtureIntoStore(store, fixture);

    const rows = await store.raw<{ cnt: number }>(
      "SELECT COUNT(*)::INTEGER AS cnt FROM commit_changes",
    );
    expect(rows[0].cnt).toBeGreaterThan(0);
  });

  it("co-failure query returns results after loading", async () => {
    const fixture = generateFixture(config);
    await loadFixtureIntoStore(store, fixture);

    const coFailures = await store.queryCoFailures({ windowDays: 365, minCoRuns: 2 });
    expect(coFailures.length).toBeGreaterThan(0);
  });
});
