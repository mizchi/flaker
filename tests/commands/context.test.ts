import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { buildContext, formatContext } from "../../src/cli/commands/analyze/context.js";

describe("flaker context", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("returns empty context for fresh store", async () => {
    const ctx = await buildContext(store, {
      storagePath: "/tmp/nonexistent/flaker.db",
      resolverConfigured: false,
    });

    expect(ctx.environment.testCount).toBe(0);
    expect(ctx.environment.commitHistory).toBe(0);
    expect(ctx.environment.coFailureDataPoints).toBe(0);
    expect(ctx.environment.resolverConfigured).toBe(false);
    expect(ctx.environment.gbdtModelAvailable).toBe(false);
  });

  it("reflects data after insertion", async () => {
    await store.insertWorkflowRun({
      id: 1, repo: "test/repo", branch: "main", commitSha: "sha1",
      event: "push", status: "completed",
      createdAt: new Date(), durationMs: 60000,
    });
    await store.insertTestResults([
      {
        workflowRunId: 1, suite: "tests/a.spec.ts", testName: "test a",
        status: "failed", durationMs: 100, retryCount: 0, errorMessage: "err",
        commitSha: "sha1", variant: null, createdAt: new Date(),
      },
      {
        workflowRunId: 1, suite: "tests/b.spec.ts", testName: "test b",
        status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
        commitSha: "sha1", variant: null, createdAt: new Date(),
      },
    ]);
    await store.insertCommitChanges("sha1", [
      { filePath: "src/foo.ts", changeType: "modified", additions: 5, deletions: 2 },
    ]);

    const ctx = await buildContext(store, {
      storagePath: "/tmp/nonexistent/flaker.db",
      resolverConfigured: true,
    });

    expect(ctx.environment.testCount).toBe(2);
    expect(ctx.environment.uniqueSuites).toBe(2);
    expect(ctx.environment.commitHistory).toBe(1);
    expect(ctx.environment.commitsWithChanges).toBe(1);
    expect(ctx.environment.resolverConfigured).toBe(true);
  });

  it("lists all 6 strategies with characteristics", async () => {
    const ctx = await buildContext(store, {
      storagePath: "/tmp/nonexistent/flaker.db",
      resolverConfigured: false,
    });

    expect(Object.keys(ctx.strategies)).toHaveLength(6);
    expect(ctx.strategies.random).toBeDefined();
    expect(ctx.strategies.hybrid).toBeDefined();
    expect(ctx.strategies.gbdt).toBeDefined();

    // Each strategy has characteristics
    for (const [, info] of Object.entries(ctx.strategies)) {
      expect(info.characteristics.length).toBeGreaterThan(0);
    }
  });

  it("formats readable text output", async () => {
    const ctx = await buildContext(store, {
      storagePath: "/tmp/nonexistent/flaker.db",
      resolverConfigured: false,
    });

    const output = formatContext(ctx);
    expect(output).toContain("Flaker Context");
    expect(output).toContain("Environment");
    expect(output).toContain("Available Strategies");
    expect(output).toContain("random");
    expect(output).toContain("hybrid");
  });

  it("JSON output is serializable", async () => {
    const ctx = await buildContext(store, {
      storagePath: "/tmp/nonexistent/flaker.db",
      resolverConfigured: false,
    });

    const json = JSON.stringify(ctx);
    const parsed = JSON.parse(json);
    expect(parsed.environment.testCount).toBe(0);
    expect(parsed.strategies.random.characteristics).toBeInstanceOf(Array);
  });
});
