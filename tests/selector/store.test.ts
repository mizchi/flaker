// tests/selector/store.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { parseSelectorRecord } from "../../src/cli/contracts/selector-record-v1.js";
import { insertSelectorRecord, resolveSelectorTestKeys } from "../../src/cli/selector/store.js";
import { keyFor, memoryStore, seedRun } from "../datasets/helpers.js";

const record = parseSelectorRecord(JSON.parse(readFileSync(
  resolve(import.meta.dirname, "../fixtures/selector-record/valid.json"), "utf8")));

describe("selector record storage", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = await memoryStore();
  });
  afterEach(async () => {
    await store.close();
  });

  it("inserts once per content; a re-import is a duplicate", async () => {
    const first = await insertSelectorRecord(store, record);
    const second = await insertSelectorRecord(store, record);
    expect(first.inserted).toBe(true);
    expect(second).toEqual({ selectorRunId: first.selectorRunId, inserted: false });
    const rows = await store.raw<{ n: number }>(`SELECT COUNT(*)::INTEGER AS n FROM flaker_v1.selector_verdicts`);
    expect(rows[0].n).toBe(2);
  });

  it("resolves keys for tests flaker already knows, and again after later imports", async () => {
    await insertSelectorRecord(store, record);
    expect(await resolveSelectorTestKeys(store)).toEqual({ resolved: 0, unresolved: 2 });
    await seedRun(store, { id: 1, commitSha: record.head_sha!, daysAgo: 0, results: [
      { suite: "tests/init.test.ts", testName: "init writes toml", titlePath: ["init", "writes toml"], status: "failed" },
    ] });
    expect(await resolveSelectorTestKeys(store)).toEqual({ resolved: 1, unresolved: 1 });
    const [row] = await store.raw<{ test_key: string }>(
      `SELECT test_key FROM flaker_v1.selector_verdicts WHERE file = 'tests/init.test.ts'`,
    );
    expect(row.test_key).toBe(await keyFor(store, "tests/init.test.ts", "init writes toml"));
  });
});
