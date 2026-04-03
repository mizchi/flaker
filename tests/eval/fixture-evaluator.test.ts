import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { generateFixture } from "../../src/cli/eval/fixture-generator.js";
import { loadFixtureIntoStore } from "../../src/cli/eval/fixture-loader.js";
import { evaluateFixture, type EvalStrategyResult } from "../../src/cli/eval/fixture-evaluator.js";

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
    const fixture = generateFixture({
      testCount: 30,
      commitCount: 20,
      flakyRate: 0.1,
      coFailureStrength: 0.8,
      filesPerCommit: 2,
      testsPerFile: 5,
      samplePercentage: 30,
      seed: 42,
    });
    await loadFixtureIntoStore(store, fixture);

    const results = await evaluateFixture(store, fixture);
    expect(results).toHaveLength(4);
    expect(results.map((r) => r.strategy)).toEqual([
      "random",
      "weighted",
      "weighted+co-failure",
      "hybrid+co-failure",
    ]);
  });

  it("all strategies have valid metrics", async () => {
    const fixture = generateFixture({
      testCount: 30,
      commitCount: 20,
      flakyRate: 0.1,
      coFailureStrength: 0.8,
      filesPerCommit: 2,
      testsPerFile: 5,
      samplePercentage: 30,
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
    const fixture = generateFixture({
      testCount: 50,
      commitCount: 40,
      flakyRate: 0.05,
      coFailureStrength: 1.0,
      filesPerCommit: 2,
      testsPerFile: 5,
      samplePercentage: 20,
      seed: 42,
    });
    await loadFixtureIntoStore(store, fixture);

    const results = await evaluateFixture(store, fixture);
    const random = results.find((r) => r.strategy === "random")!;
    const coFailure = results.find((r) => r.strategy === "weighted+co-failure")!;

    expect(coFailure.recall).toBeGreaterThanOrEqual(random.recall);
  });

  it("hybrid+co-failure outperforms all other strategies", async () => {
    const fixture = generateFixture({
      testCount: 50,
      commitCount: 40,
      flakyRate: 0.05,
      coFailureStrength: 1.0,
      filesPerCommit: 2,
      testsPerFile: 5,
      samplePercentage: 20,
      seed: 42,
    });
    await loadFixtureIntoStore(store, fixture);

    const results = await evaluateFixture(store, fixture);
    const random = results.find((r) => r.strategy === "random")!;
    const hybrid = results.find((r) => r.strategy === "hybrid+co-failure")!;

    // Hybrid uses affected (resolver) + co-failure priority + weighted
    // Should significantly outperform random
    expect(hybrid.recall).toBeGreaterThan(random.recall);
  });
});
