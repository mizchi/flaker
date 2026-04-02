import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runCollectLocal, type CollectLocalResult } from "../../src/cli/commands/collect-local.js";

function makeRunViewJson(runId: string, conclusion: string, tasks: { id: string; status: string; code: number }[]) {
  return JSON.stringify({
    run_id: runId,
    conclusion,
    headSha: `sha-${runId}`,
    headBranch: "main",
    startedAt: "2026-03-31T10:00:00Z",
    completedAt: "2026-03-31T10:05:00Z",
    status: "completed",
    tasks: tasks.map((t) => ({ ...t, kind: "run", shell: "bash" })),
    steps: [],
  });
}

describe("collect-local command", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("imports actrun run history", async () => {
    const listJson = JSON.stringify([
      { run_id: "run-1", conclusion: "success", status: "completed" },
      { run_id: "run-2", conclusion: "failure", status: "completed" },
    ]);

    const viewResults: Record<string, string> = {
      "run-1": makeRunViewJson("run-1", "success", [
        { id: "build/compile", status: "ok", code: 0 },
        { id: "test/unit", status: "ok", code: 0 },
      ]),
      "run-2": makeRunViewJson("run-2", "failure", [
        { id: "build/compile", status: "ok", code: 0 },
        { id: "test/unit", status: "failed", code: 1 },
      ]),
    };

    const result = await runCollectLocal({
      store,
      exec: (cmd) => {
        if (cmd.includes("run list")) return listJson;
        const match = cmd.match(/run view (\S+)/);
        if (match) return viewResults[match[1]];
        return "";
      },
    });

    expect(result.runsImported).toBe(2);
    expect(result.testsImported).toBe(4);

    const runs = await store.raw<{ cnt: number }>("SELECT COUNT(*)::INTEGER AS cnt FROM workflow_runs");
    expect(runs[0].cnt).toBe(2);

    const tests = await store.raw<{ cnt: number }>("SELECT COUNT(*)::INTEGER AS cnt FROM test_results");
    expect(tests[0].cnt).toBe(4);

    const taskIds = await store.raw<{ task_id: string }>(
      "SELECT task_id FROM test_results ORDER BY task_id",
    );
    expect(taskIds.map((row) => row.task_id)).toEqual([
      "build/compile",
      "build/compile",
      "test/unit",
      "test/unit",
    ]);
  });

  it("skips already imported runs", async () => {
    const listJson = JSON.stringify([
      { run_id: "run-1", conclusion: "success", status: "completed" },
    ]);
    const viewJson = makeRunViewJson("run-1", "success", [
      { id: "build/compile", status: "ok", code: 0 },
    ]);

    const execFn = (cmd: string) => {
      if (cmd.includes("run list")) return listJson;
      if (cmd.includes("run view")) return viewJson;
      return "";
    };

    // First import
    await runCollectLocal({ store, exec: execFn });

    // Second import - should skip
    const result2 = await runCollectLocal({ store, exec: execFn });
    expect(result2.runsImported).toBe(0);
    expect(result2.testsImported).toBe(0);

    const runs = await store.raw<{ cnt: number }>("SELECT COUNT(*)::INTEGER AS cnt FROM workflow_runs");
    expect(runs[0].cnt).toBe(1);
  });

  it("respects --last option", async () => {
    const listJson = JSON.stringify([
      { run_id: "run-1", conclusion: "success", status: "completed" },
      { run_id: "run-2", conclusion: "success", status: "completed" },
      { run_id: "run-3", conclusion: "success", status: "completed" },
    ]);

    let capturedCmd = "";
    const result = await runCollectLocal({
      store,
      last: 2,
      exec: (cmd) => {
        capturedCmd = cmd;
        if (cmd.includes("run list")) return listJson;
        if (cmd.includes("run view")) {
          return makeRunViewJson("run-x", "success", [
            { id: "test/a", status: "ok", code: 0 },
          ]);
        }
        return "";
      },
    });

    // Should only import the first 2 (last=2)
    expect(result.runsImported).toBe(2);
  });

  it("handles empty run list", async () => {
    const result = await runCollectLocal({
      store,
      exec: () => "[]",
    });
    expect(result.runsImported).toBe(0);
    expect(result.testsImported).toBe(0);
  });
});
