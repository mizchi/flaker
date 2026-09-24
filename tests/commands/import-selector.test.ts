// tests/commands/import-selector.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import {
  formatImportSelector, importSelectorDiagnostics, listRecordFiles, runImportSelector, SelectorImportPathError,
} from "../../src/cli/commands/import/selector.js";
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

  it("records a database error as that file's error and imports the rest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flaker-jev-"));
    copyFileSync(join(FIX, "jev/record-v1.json"), join(dir, "a.json"));
    copyFileSync(join(FIX, "jev/record-v2.json"), join(dir, "b.json"));
    let runInserts = 0;
    const failing = new Proxy(store, {
      get(target, prop) {
        if (prop === "raw") {
          return async (sql: string, params?: unknown[]) => {
            if (sql.includes("INSERT INTO selector_runs") && ++runInserts === 1) throw new Error("disk full");
            return target.raw(sql, params);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = await runImportSelector({ store: failing, path: dir, adapter: "jev" });
    expect(result.imported).toBe(1);
    expect(result.failed).toEqual([{ file: join(dir, "a.json"), error: "disk full" }]);
    const diag = importSelectorDiagnostics(result);
    expect(diag.exitCode).toBe(1);
    expect(diag.stderr).toContain(`${join(dir, "a.json")}: disk full`);
  });

  it("rejects a missing path with a user-facing error", async () => {
    const missing = join(tmpdir(), "flaker-no-such-selector-path");
    await expect(runImportSelector({ store, path: missing, adapter: "jev" }))
      .rejects.toThrow(new SelectorImportPathError(missing));
    expect(new SelectorImportPathError(missing).message).toBe(`no such file or directory: ${missing}`);
  });

  it("warns, without failing, when a directory has no records", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flaker-jev-"));
    const result = await runImportSelector({ store, path: dir, adapter: "jev" });
    expect(result.warnings).toEqual([`no .json records found in ${dir}`]);
    const diag = importSelectorDiagnostics(result);
    expect(diag).toEqual({ stderr: [`warning: no .json records found in ${dir}`], exitCode: 0 });
  });

  it("says the match counts cover the whole database", async () => {
    const result = await runImportSelector({ store, path: join(FIX, "selector-record/valid.json"), adapter: "selector-record" });
    expect(formatImportSelector(result)).toContain("0 of 2 unresolved tests in the database now match a known test");
  });
});
