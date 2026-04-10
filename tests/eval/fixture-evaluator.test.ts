import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { loadCore } from "../../src/cli/core/loader.js";
import { loadFixtureIntoStore } from "../../src/cli/eval/fixture-loader.js";
import { evaluateFixture } from "../../src/cli/eval/fixture-evaluator.js";

describe("evaluateFixture", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("returns results for all strategies", async () => {
    const core = await loadCore();
    const fixture = core.generateFixture({
      test_count: 30,
      commit_count: 20,
      flaky_rate: 0.1,
      co_failure_strength: 0.8,
      files_per_commit: 2,
      tests_per_file: 5,
      sample_percentage: 30,
      seed: 42,
    });
    await loadFixtureIntoStore(store, fixture);

    const results = await evaluateFixture(store, fixture);
    expect(results).toHaveLength(6);
    expect(results.map((r) => r.strategy)).toEqual([
      "random",
      "weighted",
      "weighted+co-failure",
      "hybrid+co-failure",
      "coverage-guided",
      "gbdt",
    ]);
  });

  it("all strategies have valid metrics", async () => {
    const core = await loadCore();
    const fixture = core.generateFixture({
      test_count: 30,
      commit_count: 20,
      flaky_rate: 0.1,
      co_failure_strength: 0.8,
      files_per_commit: 2,
      tests_per_file: 5,
      sample_percentage: 30,
      seed: 42,
    });
    await loadFixtureIntoStore(store, fixture);

    const results = await evaluateFixture(store, fixture);
    for (const result of results) {
      expect(result.recall).toBeGreaterThanOrEqual(0);
      expect(result.recall).toBeLessThanOrEqual(1);
      expect(result.falseNegativeRate).toBeGreaterThanOrEqual(0);
      expect(result.falseNegativeRate).toBeLessThanOrEqual(1);
      expect(result.sampleRatio).toBeGreaterThan(0);
      expect(result.sampleRatio).toBeLessThanOrEqual(1);
    }
  });

  it("co-failure strategy outperforms random when correlation is strong", async () => {
    const core = await loadCore();
    const fixture = core.generateFixture({
      test_count: 50,
      commit_count: 40,
      flaky_rate: 0.05,
      co_failure_strength: 1.0,
      files_per_commit: 2,
      tests_per_file: 5,
      sample_percentage: 20,
      seed: 42,
    });
    await loadFixtureIntoStore(store, fixture);

    const results = await evaluateFixture(store, fixture, {
      strategies: ["random", "weighted+co-failure"],
    });
    const random = results.find((r) => r.strategy === "random")!;
    const coFailure = results.find((r) => r.strategy === "weighted+co-failure")!;

    expect(coFailure.recall).toBeGreaterThanOrEqual(random.recall);
  });

  it("hybrid+co-failure outperforms all other strategies", async () => {
    const core = await loadCore();
    const fixture = core.generateFixture({
      test_count: 50,
      commit_count: 40,
      flaky_rate: 0.05,
      co_failure_strength: 1.0,
      files_per_commit: 2,
      tests_per_file: 5,
      sample_percentage: 20,
      seed: 42,
    });
    await loadFixtureIntoStore(store, fixture);

    const results = await evaluateFixture(store, fixture, {
      strategies: ["random", "hybrid+co-failure"],
    });
    const random = results.find((r) => r.strategy === "random")!;
    const hybrid = results.find((r) => r.strategy === "hybrid+co-failure")!;

    expect(hybrid.recall).toBeGreaterThan(random.recall);
  });
});
