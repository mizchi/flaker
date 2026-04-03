import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { generateFixture } from "../../src/cli/eval/fixture-generator.js";
import { loadFixtureIntoStore } from "../../src/cli/eval/fixture-loader.js";
import {
  tuneAlpha,
  findBestAlpha,
  formatTuningReport,
  loadTuningConfig,
  saveTuningConfig,
} from "../../src/cli/eval/alpha-tuner.js";

describe("alpha tuner", () => {
  let store: DuckDBStore;
  let tmpDir: string;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
    tmpDir = join(tmpdir(), `flaker-tune-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("tunes alpha over grid of values", async () => {
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

    // Build ground truth from last 25% of commits
    const evalStart = Math.floor(fixture.commits.length * 0.75);
    const evalCommits = fixture.commits.slice(evalStart);

    const changedFilesPerCommit = new Map<string, string[]>();
    const groundTruth = new Map<string, Set<string>>();
    for (const commit of evalCommits) {
      changedFilesPerCommit.set(commit.sha, commit.changedFiles.map((f) => f.filePath));
      groundTruth.set(
        commit.sha,
        new Set(commit.testResults.filter((r) => r.status === "failed").map((r) => r.suite)),
      );
    }

    const results = await tuneAlpha({
      store,
      changedFilesPerCommit,
      groundTruth,
      allTestSuites: fixture.tests.map((t) => t.suite),
      sampleCount: Math.round(fixture.tests.length * 0.3),
      alphaValues: [0, 0.5, 1.0, 2.0],
    });

    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r.recall).toBeGreaterThanOrEqual(0);
      expect(r.recall).toBeLessThanOrEqual(1);
      expect(r.f1).toBeGreaterThanOrEqual(0);
    }
  });

  it("findBestAlpha picks highest F1", () => {
    const results = [
      { alpha: 0, recall: 0.2, precision: 0.1, f1: 0.13 },
      { alpha: 1, recall: 0.5, precision: 0.3, f1: 0.375 },
      { alpha: 2, recall: 0.4, precision: 0.2, f1: 0.267 },
    ];
    const best = findBestAlpha(results);
    expect(best.alpha).toBe(1);
  });

  it("saves and loads tuning config", () => {
    const storagePath = join(tmpDir, "flaker.db");
    saveTuningConfig(storagePath, { alpha: 2.5 });

    const modelsDir = join(tmpDir, "models");
    expect(existsSync(join(modelsDir, "tuning.json"))).toBe(true);

    const loaded = loadTuningConfig(storagePath);
    expect(loaded.alpha).toBe(2.5);
  });

  it("loadTuningConfig returns default when file missing", () => {
    const loaded = loadTuningConfig(join(tmpDir, "nonexistent.db"));
    expect(loaded.alpha).toBe(1.0);
  });

  it("formatTuningReport marks best alpha", () => {
    const results = [
      { alpha: 0, recall: 0.2, precision: 0.1, f1: 0.13 },
      { alpha: 1, recall: 0.5, precision: 0.3, f1: 0.375 },
    ];
    const report = formatTuningReport(results);
    expect(report).toContain("Alpha Tuning Results");
    expect(report).toContain("Best alpha: 1");
    expect(report).toContain("*");
  });
});
