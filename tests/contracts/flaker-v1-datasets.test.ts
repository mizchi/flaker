// tests/contracts/flaker-v1-datasets.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { DATASET_NAMES } from "../../src/cli/datasets/registry.js";
import { FLAKER_V1_SCHEMAS } from "../../src/cli/contracts/flaker-v1-datasets.js";
import { readDataset } from "../../src/cli/datasets/read.js";
import { keyFor, memoryStore, seedRun, seedSelectorRun } from "../datasets/helpers.js";
import { validator } from "./ajv.js";

describe("flaker_v1 dataset contracts", () => {
  let store: DuckDBStore;
  beforeAll(async () => {
    store = await memoryStore();
    await store.insertCommitChanges("H", [{ filePath: "src/a.ts", changeType: "modified", additions: 1, deletions: 0 }]);
    await store.insertCommitChanges("G", [{ filePath: "src/a.ts", changeType: "modified", additions: 1, deletions: 0 }]);
    await seedRun(store, { id: 1, commitSha: "G", daysAgo: 2, results: [
      { suite: "tests/a.test.ts", testName: "a", titlePath: ["a"], status: "failed" },
      { suite: "tests/p.spec.ts", testName: "p", titlePath: ["P", "p"], status: "passed", retryCount: 1, variant: { project: "chromium" } },
    ] });
    await seedRun(store, { id: 2, commitSha: "H", daysAgo: 1, results: [
      { suite: "tests/a.test.ts", testName: "a", titlePath: ["a"], status: "failed" },
      { suite: "tests/p.spec.ts", testName: "p", titlePath: ["P", "p"], status: "passed", variant: { project: "chromium" } },
    ] });
    await store.addQuarantine({ suite: "tests/p.spec.ts", testName: "p", variant: { project: "chromium" } }, "manual");
    await seedSelectorRun(store, { id: "sr", headSha: "H", tests: [
      { testKey: await keyFor(store, "tests/a.test.ts", "a"), file: "tests/a.test.ts", titlePath: ["a"], reason: "below", selected: false, score: 0.2, confidence: 0.9 },
    ] });
    await store.raw(`INSERT INTO gate_calibrations VALUES ('jev', ?, 2, 0.5, 1, 1, 1, NULL, 'keep', 'r')`, [new Date()]);
  });
  afterAll(async () => {
    await store.close();
  });

  it("has a schema for every dataset and nothing else", () => {
    expect(Object.keys(FLAKER_V1_SCHEMAS).sort()).toEqual([...DATASET_NAMES].sort());
  });

  for (const name of DATASET_NAMES) {
    it(`${name}: view columns equal the schema's properties`, async () => {
      const cols = await store.raw<{ column_name: string }>(`DESCRIBE flaker_v1.${name}`);
      const props = Object.keys((FLAKER_V1_SCHEMAS[name] as { properties: object }).properties);
      expect(cols.map((c) => c.column_name)).toEqual(props);
    });

    it(`${name}: every exported row validates`, async () => {
      const rows = await readDataset(store, name);
      expect(rows.length).toBeGreaterThan(0);
      const check = validator(FLAKER_V1_SCHEMAS[name]);
      for (const row of rows) expect(check(row)).toBeNull();
    });
  }

  it("serializes bigint, timestamps and JSON columns to plain JSON values", async () => {
    const [run] = await readDataset(store, "runs");
    expect(typeof run.run_id).toBe("number");
    expect(typeof run.created_at).toBe("string");
    const [test] = await readDataset(store, "tests");
    expect(Array.isArray(test.title_path)).toBe(true);
  });
});
