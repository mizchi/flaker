import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";

describe("DuckDBStore.close", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("releases the file lock, so another process can open the database right after (#106)", async () => {
    dir = mkdtempSync(join(tmpdir(), "flaker-close-lock-"));
    const path = join(dir, "data.duckdb");
    const store = new DuckDBStore(path);
    await store.initialize();
    await store.addQuarantine({ suite: "s", testName: "t" }, "manual");
    await store.close();

    const child = spawnSync(
      "node",
      [
        "--input-type=module",
        "-e",
        `import { DuckDBInstance } from "@duckdb/node-api";
         const db = await DuckDBInstance.create(${JSON.stringify(path)});
         const conn = await db.connect();
         const rows = (await conn.runAndReadAll("SELECT COUNT(*)::INTEGER AS n FROM quarantined_test_identities")).getRowObjectsJS();
         console.log(rows[0].n);`,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(child.stderr).toBe("");
    expect(child.stdout.trim()).toBe("1");
  });

  it("can be called twice", async () => {
    const store = new DuckDBStore(":memory:");
    await store.initialize();
    await store.close();
    await store.close();
  });
});
