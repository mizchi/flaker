import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";

describe("commit_changes storage", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("inserts and queries commit changes", async () => {
    await store.insertCommitChanges("abc123", [
      { filePath: "src/foo.ts", changeType: "modified", additions: 10, deletions: 5 },
      { filePath: "src/bar.ts", changeType: "added", additions: 20, deletions: 0 },
    ]);

    const rows = await store.raw<{ file_path: string; change_type: string }>(
      "SELECT file_path, change_type FROM commit_changes WHERE commit_sha = ?",
      ["abc123"],
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.file_path).sort()).toEqual(["src/bar.ts", "src/foo.ts"]);
  });

  it("skips duplicates on re-insert", async () => {
    const changes = [
      { filePath: "src/foo.ts", changeType: "modified", additions: 10, deletions: 5 },
    ];
    await store.insertCommitChanges("abc123", changes);
    await store.insertCommitChanges("abc123", changes);

    const rows = await store.raw<{ cnt: number }>(
      "SELECT COUNT(*)::INTEGER AS cnt FROM commit_changes WHERE commit_sha = ?",
      ["abc123"],
    );
    expect(rows[0].cnt).toBe(1);
  });

  it("hasCommitChanges returns correct value", async () => {
    expect(await store.hasCommitChanges("abc123")).toBe(false);
    await store.insertCommitChanges("abc123", [
      { filePath: "src/foo.ts", changeType: "modified", additions: 1, deletions: 1 },
    ]);
    expect(await store.hasCommitChanges("abc123")).toBe(true);
  });
});
