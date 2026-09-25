import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";

const OLD_DDL = readFileSync(
  resolve(fileURLToPath(import.meta.url), "../../fixtures/storage/schema-0.13.0.sql"),
  "utf8",
);

async function write013Database(path: string): Promise<void> {
  const instance = await DuckDBInstance.create(path);
  const conn = await instance.connect();
  await conn.run(OLD_DDL);
  conn.closeSync();
  instance.closeSync();
}

/** Seconds between a naive-UTC timestamp read back from DuckDB and now. */
function skewSeconds(value: unknown): number {
  return Math.abs(new Date(value as string | Date).getTime() - Date.now()) / 1000;
}

async function expectUtcCreatedAt(store: DuckDBStore): Promise<void> {
  // A non-UTC session is what turned CURRENT_TIMESTAMP into local wall-clock time.
  await store.raw(`SET TimeZone = 'Asia/Tokyo'`);
  await store.addQuarantine({ suite: "s", testName: "t" }, "manual");
  const [quarantined] = await store.queryQuarantined();
  expect(skewSeconds(quarantined.createdAt)).toBeLessThan(120);
}

describe("quarantine created_at", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("are naive UTC in a non-UTC session", async () => {
    const store = new DuckDBStore(":memory:");
    await store.initialize();
    try {
      await expectUtcCreatedAt(store);
    } finally {
      await store.close();
    }
  });

  it("are corrected on a database created by 0.13.0", async () => {
    dir = mkdtempSync(join(tmpdir(), "flaker-utc-"));
    const path = join(dir, "data.duckdb");
    await write013Database(path);
    const store = new DuckDBStore(path);
    await store.initialize();
    try {
      await expectUtcCreatedAt(store);
    } finally {
      await store.close();
    }
    // The WAL written above must replay on the next open.
    const reopened = new DuckDBStore(path);
    await reopened.initialize();
    expect(await reopened.queryQuarantined()).toHaveLength(1);
    await reopened.close();
  });
});
