import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { collectCommitChanges } from "../../src/cli/commands/collect/commit-changes.js";

describe("collectCommitChanges", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("stores commit changes for HEAD", async () => {
    // Use HEAD of the flaker repo itself
    const result = await collectCommitChanges(store, process.cwd(), "HEAD");
    expect(result).not.toBeNull();
    if (result) {
      expect(result.filesCollected).toBeGreaterThan(0);
      const rows = await store.raw<{ cnt: number }>(
        "SELECT COUNT(*)::INTEGER AS cnt FROM commit_changes",
      );
      expect(rows[0].cnt).toBeGreaterThan(0);
    }
  });

  it("skips if already collected", async () => {
    await store.insertCommitChanges("abc123", [
      { filePath: "src/foo.ts", changeType: "modified", additions: 0, deletions: 0 },
    ]);
    const result = await collectCommitChanges(store, process.cwd(), "abc123");
    expect(result).toBeNull();
  });

  it("returns null for invalid sha", async () => {
    const result = await collectCommitChanges(store, process.cwd(), "0000000000000000000000000000000000000000");
    expect(result).toBeNull();
  });
});
