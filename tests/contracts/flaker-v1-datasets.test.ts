import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { DATASET_NAMES } from "../../src/cli/datasets/registry.js";
import { FLAKER_V1_SCHEMAS } from "../../src/cli/contracts/flaker-v1-datasets.js";
import { readDataset } from "../../src/cli/datasets/read.js";
import { keyFor, memoryStore, seedRun, seedSelectorRun } from "../datasets/helpers.js";
import type { JsonSchema } from "../../src/cli/contracts/json-schema.js";
import { validator } from "./ajv.js";

/** The JSON types a DuckDB column serializes to (see src/cli/datasets/serialize.ts). */
function jsonTypesOf(duckdbType: string): string[] {
  switch (duckdbType) {
    case "VARCHAR": case "TIMESTAMP": return ["string"];
    case "BIGINT": case "INTEGER": return ["integer"];
    case "DOUBLE": return ["number"];
    case "BOOLEAN": return ["boolean"];
    case "JSON": return ["array", "object"];
    default: throw new Error(`no JSON mapping for DuckDB type ${duckdbType}`);
  }
}

/** A schema's non-null JSON types (sorted), and whether it allows null. */
function schemaTypes(schema: JsonSchema): { types: string[]; nullable: boolean } {
  const raw = schema.type;
  const list = Array.isArray(raw) ? (raw as string[]) : [raw as string];
  const types = list.filter((t) => t !== "null");
  // A JSON column holds either kind; the schema narrows it to one.
  const widened = types.some((t) => t === "array" || t === "object") ? ["array", "object"] : types;
  return { types: widened.sort(), nullable: list.includes("null") };
}

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

    // Nulls in every column the schemas allow null in, so validation covers them.
    await seedRun(store, { id: 3, commitSha: "N", daysAgo: 1, results: [
      { suite: "tests/a.test.ts", testName: "a", titlePath: ["a"], status: "passed" },
    ] });
    await store.raw(`UPDATE workflow_runs SET workflow_name = NULL, branch = NULL, event = NULL, created_at = NULL WHERE id = 3`);
    await store.raw(`UPDATE test_results SET retry_count = NULL, duration_ms = NULL, created_at = NULL WHERE workflow_run_id = 3`);
    await store.raw(
      `INSERT INTO quarantined_test_identities (test_id, task_id, suite, test_name, reason, created_at)
       VALUES ('legacy-key', 't', 's', 'n', 'manual', NULL)`,
    );
    await seedSelectorRun(store, { id: "nulls", headSha: null, tests: [
      { testKey: null, file: "tests/z.test.ts", titlePath: ["z"], reason: "missing", selected: true, score: null, confidence: null },
    ] });
  });
  afterAll(async () => {
    await store.close();
  });

  it("has a schema for every dataset and nothing else", () => {
    expect(Object.keys(FLAKER_V1_SCHEMAS).sort()).toEqual([...DATASET_NAMES].sort());
  });

  for (const name of DATASET_NAMES) {
    it(`${name}: view columns equal the schema's properties, with matching types and nullability`, async () => {
      const cols = await store.raw<{ column_name: string; column_type: string; null: "YES" | "NO" }>(
        `DESCRIBE flaker_v1.${name}`,
      );
      const props = (FLAKER_V1_SCHEMAS[name] as { properties: Record<string, JsonSchema> }).properties;
      expect(cols.map((c) => c.column_name)).toEqual(Object.keys(props));
      for (const col of cols) {
        const { types, nullable } = schemaTypes(props[col.column_name]);
        expect(types, `${name}.${col.column_name} (${col.column_type})`).toEqual(jsonTypesOf(col.column_type));
        // DuckDB proves NOT NULL for some view columns; the schema must not allow null there.
        if (col.null === "NO") expect(nullable, `${name}.${col.column_name} is NOT NULL`).toBe(false);
      }
    });

    it(`${name}: the fixture has a null in every column the schema allows null in`, async () => {
      const props = (FLAKER_V1_SCHEMAS[name] as { properties: Record<string, JsonSchema> }).properties;
      const rows = await readDataset(store, name);
      for (const [column, schema] of Object.entries(props)) {
        if (!schemaTypes(schema).nullable) continue;
        expect(rows.some((r) => r[column] === null), `${name}.${column}`).toBe(true);
      }
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
