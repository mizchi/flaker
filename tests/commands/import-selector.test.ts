// tests/commands/import-selector.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { listRecordFiles, runImportSelector } from "../../src/cli/commands/import/selector.js";
import { memoryStore } from "../datasets/helpers.js";

const FIX = resolve(import.meta.dirname, "../fixtures");

function jevDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "flaker-jev-"));
  mkdirSync(join(dir, "records"));
  copyFileSync(join(FIX, "jev/record-v2.json"), join(dir, "last.json"));
  copyFileSync(join(FIX, "jev/record-v2.json"), join(dir, "records/c0ffee0000000000000000000000000000000001.json"));
  copyFileSync(join(FIX, "jev/record-v1.json"), join(dir, "records/old.json"));
  return dir;
}

describe("runImportSelector", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = await memoryStore();
  });
  afterEach(async () => {
    await store.close();
  });

  it("lists a file, or every .json in a directory and its records/ subdirectory", () => {
    const dir = jevDir();
    expect(listRecordFiles(join(dir, "last.json"))).toEqual([join(dir, "last.json")]);
    expect(listRecordFiles(dir)).toEqual([
      join(dir, "last.json"),
      join(dir, "records/c0ffee0000000000000000000000000000000001.json"),
      join(dir, "records/old.json"),
    ]);
  });

  it("imports jev records, counting last.json's copy as a duplicate", async () => {
    const result = await runImportSelector({ store, path: jevDir(), adapter: "jev" });
    expect(result).toMatchObject({ files: 3, imported: 2, duplicates: 1, invalid: [], skipped: [] });
  });

  it("skips a record that fell back, and reports an invalid file without stopping", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flaker-jev-"));
    const v2 = JSON.parse(readFileSync(join(FIX, "jev/record-v2.json"), "utf8"));
    writeFileSync(join(dir, "a.json"), JSON.stringify({ ...v2, fallback: "jev failed: x" }));
    writeFileSync(join(dir, "b.json"), "{ not json");
    copyFileSync(join(FIX, "jev/record-v1.json"), join(dir, "c.json"));
    const result = await runImportSelector({ store, path: dir, adapter: "jev" });
    expect(result.imported).toBe(1);
    expect(result.skipped).toEqual([{ file: join(dir, "a.json"), reason: "fallback" }]);
    expect(result.invalid.map((i) => i.file)).toEqual([join(dir, "b.json")]);
  });

  it("imports selector-record files as they are", async () => {
    const result = await runImportSelector({ store, path: join(FIX, "selector-record/valid.json"), adapter: "selector-record" });
    expect(result.imported).toBe(1);
    const rows = await store.raw<{ selector: string }>(`SELECT DISTINCT selector FROM flaker_v1.selector_verdicts`);
    expect(rows).toEqual([{ selector: "jev" }]);
  });
});
