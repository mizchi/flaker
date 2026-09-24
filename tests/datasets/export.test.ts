import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runExportDataset } from "../../src/cli/commands/export/dataset.js";
import { FlakerUsageError } from "../../src/cli/errors.js";
import { memoryStore, seedRun } from "./helpers.js";

describe("runExportDataset", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = await memoryStore();
    await seedRun(store, { id: 1, commitSha: "old", daysAgo: 30, results: [
      { suite: "tests/a.test.ts", testName: "a, with comma", titlePath: ["a, with comma"], status: "passed" },
    ] });
    await seedRun(store, { id: 2, commitSha: "new", daysAgo: 1, results: [
      { suite: "tests/b.test.ts", testName: "b", titlePath: ["B", "b"], status: "failed" },
    ] });
  });
  afterEach(async () => {
    await store.close();
  });

  it("json: an array of rows", async () => {
    const { text, rows } = await runExportDataset({ store, dataset: "runs", format: "json" });
    expect(rows).toBe(2);
    expect(JSON.parse(text!)).toHaveLength(2);
  });

  it("jsonl: one row per line", async () => {
    const { text } = await runExportDataset({ store, dataset: "tests", format: "jsonl" });
    const lines = text!.trimEnd().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.title_path)).toEqual(expect.arrayContaining([["B", "b"], ["a, with comma"]]));
  });

  it("csv: a header in schema order, quoted cells, JSON-encoded arrays", async () => {
    const { text } = await runExportDataset({ store, dataset: "tests", format: "csv", where: "file = 'tests/a.test.ts'" });
    const [header, row] = text!.trimEnd().split("\n");
    expect(header).toBe("test_key,suite,test_name,task_id,variant,file,title_path,first_seen_at,last_seen_at");
    expect(row).toContain(`"a, with comma"`);
    expect(row).toContain(`"[""a, with comma""]"`);
  });

  it("--since keeps rows at or after the date", async () => {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const { text } = await runExportDataset({ store, dataset: "runs", format: "json", since });
    expect(JSON.parse(text!).map((r: { commit_sha: string }) => r.commit_sha)).toEqual(["new"]);
  });

  it("rejects --since on a dataset without a time column, a bad date, and an unsafe --where", async () => {
    await expect(runExportDataset({ store, dataset: "flaky", format: "json", since: "2026-01-01" }))
      .rejects.toThrow(FlakerUsageError);
    await expect(runExportDataset({ store, dataset: "runs", format: "json", since: "yesterday" }))
      .rejects.toThrow(/Invalid --since/);
    await expect(runExportDataset({ store, dataset: "runs", format: "json", where: "1=1; DROP TABLE test_results" }))
      .rejects.toThrow(FlakerUsageError);
    await expect(runExportDataset({ store, dataset: "runs", format: "json", where: "run_id IN (SELECT 1 FROM read_csv('/etc/passwd'))" }))
      .rejects.toThrow(FlakerUsageError);
  });

  it("rejects an unknown dataset or format, and parquet without -o", async () => {
    await expect(runExportDataset({ store, dataset: "test_results", format: "json" })).rejects.toThrow(/Unknown dataset/);
    await expect(runExportDataset({ store, dataset: "runs", format: "xml" })).rejects.toThrow(/Unknown format/);
    await expect(runExportDataset({ store, dataset: "runs", format: "parquet" })).rejects.toThrow(/requires -o/);
  });

  it("parquet: writes a file DuckDB can read back", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "flaker-export-")), "runs.parquet");
    const { rows, text } = await runExportDataset({ store, dataset: "runs", format: "parquet", output: out });
    expect(rows).toBe(2);
    expect(text).toBeNull();
    const back = await store.raw<{ n: number }>(`SELECT COUNT(*)::INTEGER AS n FROM read_parquet('${out}')`);
    expect(back[0].n).toBe(2);
  });

  it("-o writes text formats to the file and returns no text", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "flaker-export-")), "runs.json");
    const { text } = await runExportDataset({ store, dataset: "runs", format: "json", output: out });
    expect(text).toBeNull();
    expect(JSON.parse(readFileSync(out, "utf8"))).toHaveLength(2);
  });
});

describe("--where is only a filter on the selected dataset", () => {
  let store: DuckDBStore;
  beforeEach(async () => {
    store = await memoryStore();
    await seedRun(store, { id: 1, commitSha: "c1", daysAgo: 1, results: [
      { suite: "tests/a.test.ts", testName: "a", status: "passed" },
    ] });
  });
  afterEach(async () => {
    await store.close();
  });

  const rejected = [
    ["a subquery", "run_id IN (SELECT id FROM workflow_runs)"],
    ["a FROM-first subquery", "run_id IN (FROM workflow_runs SELECT id)"],
    ["a TABLE subquery", "run_id IN (TABLE workflow_runs)"],
    ["a replacement scan", "run_id IN (SELECT 1 FROM '/etc/passwd')"],
    ["closing the wrapper paren", "1=1) UNION ALL (SELECT * FROM flaker_v1.runs"],
    ["an unbalanced paren", "(1=1"],
    ["a line comment", "1=1 --"],
    ["a block comment", "1=1 /* x */"],
    ["escaping COPY", "1=1)) TO '/tmp/pwn.csv' (FORMAT CSV) --"],
    ["an E-string escape", "commit_sha = E'\\' OR 1=1 --'"],
    ["a dollar-quoted string", "commit_sha = $$ ' $$"],
    ["getenv", "commit_sha = getenv('HOME')"],
  ] as const;

  for (const [label, where] of rejected) {
    it(`rejects ${label}`, async () => {
      await expect(runExportDataset({ store, dataset: "runs", format: "json", where }))
        .rejects.toThrow(FlakerUsageError);
    });
  }

  it("rejects the same fragments for parquet", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "flaker-export-")), "runs.parquet");
    await expect(runExportDataset({
      store, dataset: "runs", format: "parquet", output: out,
      where: "1=1)) TO '/tmp/pwn.csv' (FORMAT CSV) --",
    })).rejects.toThrow(FlakerUsageError);
  });

  it("accepts ordinary conditions, including keywords and parens inside strings", async () => {
    const ok = [
      "commit_sha = 'c1'",
      "commit_sha IN ('c1', 'c2') AND (run_id > 0 OR run_id IS NULL)",
      "commit_sha <> 'x; SELECT * FROM y -- (' ",
      "\"commit_sha\" LIKE 'c%'",
      "lower(commit_sha) = 'c1'",
    ];
    for (const where of ok) {
      const { rows } = await runExportDataset({ store, dataset: "runs", format: "json", where });
      expect(rows, where).toBe(1);
    }
  });
});
