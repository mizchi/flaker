import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import {
  trainModel,
  formatTrainResult,
} from "../../src/cli/commands/dev/train.js";
import { FLAKER_FEATURE_NAMES } from "../../src/cli/eval/gbdt.js";

describe("train command", () => {
  let store: DuckDBStore;
  let tmpDir: string;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
    tmpDir = join(tmpdir(), `flaker-train-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("trains a model from mixed CI/local history and writes feature names", async () => {
    const createdAt = new Date("2026-04-09T00:00:00Z");
    await store.insertWorkflowRun({
      id: 1,
      repo: "mizchi/flaker",
      branch: "main",
      commitSha: "ci-sha-1",
      event: "push",
      source: "ci",
      status: "success",
      createdAt,
      durationMs: 100,
    });
    await store.insertWorkflowRun({
      id: 2,
      repo: "mizchi/flaker",
      branch: "main",
      commitSha: "ci-sha-2",
      event: "push",
      source: "ci",
      status: "success",
      createdAt,
      durationMs: 100,
    });
    await store.insertWorkflowRun({
      id: 3,
      repo: "mizchi/flaker",
      branch: "main",
      commitSha: "local-sha-1",
      event: "flaker-local-run",
      source: "local",
      status: "success",
      createdAt,
      durationMs: 100,
    });

    await store.insertTestResults([
      {
        workflowRunId: 1,
        suite: "tests/auth.test.ts",
        testName: "login works",
        status: "failed",
        durationMs: 30,
        retryCount: 0,
        errorMessage: "boom",
        commitSha: "ci-sha-1",
        variant: null,
        createdAt,
      },
      {
        workflowRunId: 2,
        suite: "tests/auth.test.ts",
        testName: "login works",
        status: "passed",
        durationMs: 25,
        retryCount: 0,
        errorMessage: null,
        commitSha: "ci-sha-2",
        variant: null,
        createdAt,
      },
      {
        workflowRunId: 3,
        suite: "tests/auth.test.ts",
        testName: "login works",
        status: "passed",
        durationMs: 20,
        retryCount: 0,
        errorMessage: null,
        commitSha: "local-sha-1",
        variant: null,
        createdAt,
      },
    ]);

    const outputPath = join(tmpDir, "models", "gbdt.json");
    const result = await trainModel({
      store,
      storagePath: join(tmpDir, "data.duckdb"),
      outputPath,
      numTrees: 3,
      learningRate: 0.3,
    });

    expect(result).toMatchObject({
      trainingRows: 3,
      positiveCount: 1,
      negativeCount: 2,
      numTrees: 3,
      learningRate: 0.3,
      ciRows: 2,
      localRows: 1,
      modelPath: outputPath,
    });

    const model = JSON.parse(readFileSync(outputPath, "utf-8"));
    expect(model.featureNames).toEqual(FLAKER_FEATURE_NAMES);
    expect(model.feature_names).toEqual(FLAKER_FEATURE_NAMES);
  });

  it("fails with a clear error when no historical data exists", async () => {
    await expect(trainModel({
      store,
      storagePath: join(tmpDir, "data.duckdb"),
      outputPath: join(tmpDir, "models", "gbdt.json"),
    })).rejects.toThrow("No training data available");
  });

  it("formats a compact training summary", () => {
    expect(formatTrainResult({
      modelPath: "/tmp/gbdt.json",
      trainingRows: 12,
      positiveCount: 4,
      negativeCount: 8,
      numTrees: 5,
      learningRate: 0.2,
      ciRows: 9,
      localRows: 3,
    })).toContain("Training rows:    12");
  });
});
