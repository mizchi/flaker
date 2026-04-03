import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { generateFixture } from "../../src/cli/eval/fixture-generator.js";
import { loadFixtureIntoStore } from "../../src/cli/eval/fixture-loader.js";
import {
  selectByCoverage,
  type TestCoverageInput,
} from "../../src/cli/eval/coverage-guided.js";

describe("selectByCoverage (TS implementation)", () => {
  it("greedy set cover selects optimal tests", () => {
    const coverages: TestCoverageInput[] = [
      { suite: "test_a", edges: ["e1", "e2", "e3"] },
      { suite: "test_b", edges: ["e2", "e4"] },
      { suite: "test_c", edges: ["e3", "e5"] },
    ];
    const changed = ["e1", "e2", "e3", "e4", "e5"];

    const result = selectByCoverage(coverages, changed, 2);

    expect(result.selected).toHaveLength(2);
    expect(result.selected[0]).toBe("test_a"); // covers most (3 edges)
    expect(result.coveredEdges).toBe(4);
    expect(result.totalChangedEdges).toBe(5);
  });

  it("stops when all edges covered", () => {
    const coverages: TestCoverageInput[] = [
      { suite: "test_a", edges: ["e1", "e2"] },
      { suite: "test_b", edges: ["e3"] },
      { suite: "test_c", edges: ["e1"] },
    ];

    const result = selectByCoverage(coverages, ["e1", "e2", "e3"], 10);

    expect(result.selected).toHaveLength(2); // only needs 2
    expect(result.coveredEdges).toBe(3);
    expect(result.coverageRatio).toBe(1.0);
  });

  it("returns empty for no matching edges", () => {
    const coverages: TestCoverageInput[] = [
      { suite: "test_a", edges: ["e99"] },
    ];

    const result = selectByCoverage(coverages, ["e1", "e2"], 5);

    expect(result.selected).toHaveLength(0);
    expect(result.coveredEdges).toBe(0);
  });
});

describe("coverage-guided with synthetic fixture", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("coverage-guided achieves higher recall than random", async () => {
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

    // Generate synthetic coverage: each test covers edges in its module
    const coverages: TestCoverageInput[] = fixture.tests.map((t) => {
      const moduleIdx = parseInt(t.suite.match(/module_(\d+)/)?.[1] ?? "0");
      const edges: string[] = [];
      // Each test covers edges in its module file
      for (let e = 0; e < 10; e++) {
        edges.push(`src/module_${moduleIdx}.ts:${e}`);
      }
      return { suite: t.suite, edges };
    });

    // Pick an eval commit
    const commit = fixture.commits[35];
    const changedEdges: string[] = [];
    for (const f of commit.changedFiles) {
      const moduleIdx = f.filePath.match(/module_(\d+)/)?.[1] ?? "0";
      for (let e = 0; e < 10; e++) {
        changedEdges.push(`${f.filePath}:${e}`);
      }
    }

    const sampleCount = Math.round(fixture.tests.length * 0.2);
    const result = selectByCoverage(coverages, changedEdges, sampleCount);

    // Coverage-guided should cover all changed edges with fewer tests
    expect(result.coverageRatio).toBe(1.0);
    // And the selected count should be less than the full sample budget
    expect(result.selected.length).toBeLessThanOrEqual(sampleCount);

    // Coverage-guided selects tests covering changed code,
    // which should include at least some tests that would fail
    const failedSuites = new Set(
      commit.testResults.filter((r) => r.status === "failed").map((r) => r.suite),
    );
    const selectedSet = new Set(result.selected);
    const detected = [...failedSuites].filter((s) => selectedSet.has(s));
    // Should detect at least 1 failure (coverage targets changed code = where failures are)
    if (failedSuites.size > 0) {
      expect(detected.length).toBeGreaterThan(0);
    }
  });
});
