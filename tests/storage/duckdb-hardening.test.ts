import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";

const settings = async (store: DuckDBStore) => {
  const [row] = await store.raw<{ t: string; a: string[] }>(
    `SELECT current_setting('temp_directory') AS t, current_setting('allowed_directories') AS a`,
  );
  return row;
};

describe("DuckDBStore hardening", () => {
  const stores: DuckDBStore[] = [];
  const open = async (path: string, opts?: { readOnly?: boolean }) => {
    const store = new DuckDBStore(path, opts);
    await store.initialize();
    stores.push(store);
    return store;
  };
  afterEach(async () => {
    for (const s of stores.splice(0)) await s.close();
  });

  it("an in-memory store spills to an absolute private temp directory once external access is off", async () => {
    const store = await open(":memory:");
    await store.disableExternalAccess();
    const { t, a } = await settings(store);
    expect(isAbsolute(t)).toBe(true);
    expect(t.startsWith(tmpdir()) || t.startsWith("/private" + tmpdir())).toBe(true);
    expect(a).toEqual([`${t}/`]); // DuckDB stores directories with a trailing slash
  });

  it("a file store spills to the absolute <db>.tmp", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flaker-temp-"));
    const store = await open(join(dir, "data"));
    await store.disableExternalAccess();
    const { t, a } = await settings(store);
    expect(t).toBe(join(dir, "data.tmp"));
    expect(a).toEqual([`${t}/`]); // DuckDB stores directories with a trailing slash
  });

  it("a read-only store answers SELECTs and refuses writes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flaker-ro-"));
    const path = join(dir, "data");
    const writer = new DuckDBStore(path);
    await writer.initialize();
    await writer.close();
    const store = await open(path, { readOnly: true });
    await expect(store.raw("SELECT COUNT(*)::INTEGER AS n FROM flaker_v1.runs")).resolves.toHaveLength(1);
    await expect(store.raw("CREATE TABLE evil(a INT)")).rejects.toThrow(/read-only/);
    await expect(store.raw("INSERT INTO workflow_runs (id) VALUES (1)")).rejects.toThrow(/read-only/);
  });

  it("refuses a read-only in-memory store", async () => {
    await expect(new DuckDBStore(":memory:", { readOnly: true }).initialize()).rejects.toThrow(/read-only/);
  });
});
