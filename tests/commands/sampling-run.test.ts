import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { recordSamplingRunFromSummary } from "../../src/cli/commands/sampling-run.js";
import type { SamplingSummary } from "../../src/cli/commands/sample.js";

describe("recordSamplingRunFromSummary", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("persists sampling run metadata and sampled tests in order", async () => {
    const summary: SamplingSummary = {
      strategy: "hybrid",
      requestedCount: 2,
      requestedPercentage: null,
      seed: 42,
      changedFiles: ["src/example.ts"],
      candidateCount: 4,
      selectedCount: 2,
      sampleRatio: 50,
      estimatedSavedTests: 2,
      estimatedSavedMinutes: 1.2,
      fallbackReason: "cold-start-listed-tests",
    };

    await recordSamplingRunFromSummary(store, {
      commitSha: "abc123",
      commandKind: "run",
      summary,
      tests: [
        {
          suite: "tests/home.spec.ts",
          test_name: "home works",
          task_id: "home",
          test_id: "home-id",
        },
        {
          suite: "tests/auth.spec.ts",
          testName: "auth works",
          taskId: "auth",
          filter: "@smoke",
          testId: "auth-id",
        },
      ],
      durationMs: 12_345,
    });

    const runs = await store.raw<Array<{
      commit_sha: string;
      command_kind: string;
      strategy: string;
      candidate_count: number;
      selected_count: number;
      fallback_reason: string | null;
      duration_ms: number | null;
    }>[number]>(`
      SELECT
        commit_sha,
        command_kind,
        strategy,
        candidate_count,
        selected_count,
        fallback_reason,
        duration_ms
      FROM sampling_runs
    `);
    expect(runs).toEqual([
      {
        commit_sha: "abc123",
        command_kind: "run",
        strategy: "hybrid",
        candidate_count: 4,
        selected_count: 2,
        fallback_reason: "cold-start-listed-tests",
        duration_ms: 12345,
      },
    ]);

    const tests = await store.raw<Array<{
      ordinal: number;
      suite: string;
      test_name: string;
      task_id: string | null;
      filter_text: string | null;
      test_id: string | null;
    }>[number]>(`
      SELECT
        ordinal,
        suite,
        test_name,
        task_id,
        filter_text,
        test_id
      FROM sampling_run_tests
      ORDER BY ordinal
    `);
    expect(tests).toEqual([
      {
        ordinal: 0,
        suite: "tests/home.spec.ts",
        test_name: "home works",
        task_id: "home",
        filter_text: null,
        test_id: "home-id",
      },
      {
        ordinal: 1,
        suite: "tests/auth.spec.ts",
        test_name: "auth works",
        task_id: "auth",
        filter_text: "@smoke",
        test_id: "auth-id",
      },
    ]);
  });
});
