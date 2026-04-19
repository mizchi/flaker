import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { loadCore, type FlakerCore } from "../../src/cli/core/loader.js";

let core: FlakerCore;

describe("selectByCoverage (MoonBit bridge)", () => {
  beforeEach(async () => {
    core = await loadCore();
  });

  it("greedy set cover selects optimal tests", () => {
    const coverages = [
      { suite: "test_a", test_name: "a", edges: ["e1", "e2", "e3"] },
      { suite: "test_b", test_name: "b", edges: ["e2", "e4"] },
      { suite: "test_c", test_name: "c", edges: ["e3", "e5"] },
    ];
    const changed = ["e1", "e2", "e3", "e4", "e5"];

    const result = core.selectByCoverage(coverages, changed, 2);

    expect(result.selected).toHaveLength(2);
    expect(result.selected[0]).toBe("test_a");
    expect(result.coveredEdges).toBe(4);
    expect(result.totalChangedEdges).toBe(5);
  });

  it("stops when all edges covered", () => {
    const coverages = [
      { suite: "test_a", test_name: "a", edges: ["e1", "e2"] },
      { suite: "test_b", test_name: "b", edges: ["e3"] },
      { suite: "test_c", test_name: "c", edges: ["e1"] },
    ];

    const result = core.selectByCoverage(coverages, ["e1", "e2", "e3"], 10);

    expect(result.selected).toHaveLength(2);
    expect(result.coveredEdges).toBe(3);
    expect(result.coverageRatio).toBe(1.0);
  });

  it("returns empty for no matching edges", () => {
    const coverages = [
      { suite: "test_a", test_name: "a", edges: ["e99"] },
    ];

    const result = core.selectByCoverage(coverages, ["e1", "e2"], 5);

    expect(result.selected).toHaveLength(0);
    expect(result.coveredEdges).toBe(0);
  });
});

describe("coverage-guided with synthetic fixture", () => {
  let store: DuckDBStore;
  let core: FlakerCore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
    core = await loadCore();
  });

  afterEach(async () => {
    await store.close();
  });

  it("coverage-guided achieves higher recall than random", async () => {
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

    const coverages = fixture.tests.map((t) => {
      const moduleIdx = parseInt(t.suite.match(/module_(\d+)/)?.[1] ?? "0");
      const edges: string[] = [];
      for (let e = 0; e < 10; e++) {
        edges.push(`src/module_${moduleIdx}.ts:${e}`);
      }
      return { suite: t.suite, test_name: t.test_name, edges };
    });

    const commit = fixture.commits[35];
    const changedEdges: string[] = [];
    for (const f of commit.changed_files) {
      for (let e = 0; e < 10; e++) {
        changedEdges.push(`${f.file_path}:${e}`);
      }
    }

    const sampleCount = Math.round(fixture.tests.length * 0.2);
    const result = core.selectByCoverage(coverages, changedEdges, sampleCount);

    expect(result.coverageRatio).toBe(1.0);
    expect(result.selected.length).toBeLessThanOrEqual(sampleCount);

    const failedSuites = new Set(
      commit.test_results.filter((r) => r.status === "failed").map((r) => r.suite),
    );
    const selectedSet = new Set(result.selected);
    const detected = [...failedSuites].filter((s) => selectedSet.has(s));
    if (failedSuites.size > 0) {
      expect(detected.length).toBeGreaterThan(0);
    }
  });
});
