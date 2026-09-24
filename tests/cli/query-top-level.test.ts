import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FILESYSTEM_FUNCTIONS } from "../../src/cli/commands/analyze/sql-guard.js";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("flaker query", () => {
  it("`flaker query --help` lists the SQL positional argument", () => {
    const res = spawnSync("node", [CLI, "query", "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/sql/i);
  });

  it("`flaker analyze query` is no longer a valid command (removed in 0.8.0)", () => {
    // Note: --help is omitted; Commander intercepts it before unknown-command detection.
    const res = spawnSync("node", [CLI, "analyze", "query"], { encoding: "utf8" });
    expect(res.status).not.toBe(0);
  });
});

describe("flaker query and files", () => {
  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), "flaker-query-cli-"));
    writeFileSync(join(dir, "flaker.toml"), `[repo]\nowner = "a"\nname = "b"\n[storage]\npath = ".flaker/data"\n`);
    writeFileSync(join(dir, "secret.csv"), "secret_col\nhunter2\n");
    return dir;
  };
  const query = (dir: string, sql: string) => spawnSync("node", [CLI, "query", sql], { cwd: dir, encoding: "utf8" });

  it("still answers ordinary queries", () => {
    const res = query(repo(), "SELECT COUNT(*)::INTEGER AS n FROM flaker_v1.runs");
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain("n");
  });

  it("cannot read a file through a replacement scan or PIVOT_LONGER", () => {
    const dir = repo();
    for (const sql of [
      "SELECT * FROM 'secret.csv'",
      "SELECT * FROM (PIVOT_LONGER 'secret.csv' ON COLUMNS(*) INTO NAME k VALUE v)",
    ]) {
      const res = query(dir, sql);
      expect(res.status, sql).not.toBe(0);
      expect(res.stdout + res.stderr).not.toContain("hunter2");
    }
  });

  it("names the file table functions it rejects up front", () => {
    for (const fn of ["read_ndjson_objects(", "read_json_objects(", "sniff_csv(", "parquet_metadata(",
      "parquet_schema(", "iceberg_scan(", "delta_scan(", "read_text(", "read_csv_auto("]) {
      expect(FILESYSTEM_FUNCTIONS.test(`x FROM ${fn}'f')`), fn).toBe(true);
    }
    expect(FILESYSTEM_FUNCTIONS.test("thread_count(1)")).toBe(false);
  });
});

describe("flaker query runs one read-only statement", () => {
  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), "flaker-query-ro-"));
    writeFileSync(join(dir, "flaker.toml"), `[repo]\nowner = "a"\nname = "b"\n[storage]\npath = ".flaker/data"\n`);
    return dir;
  };
  const query = (dir: string, sql: string) => spawnSync("node", [CLI, "query", sql], { cwd: dir, encoding: "utf8" });
  const tableCount = (dir: string) => {
    const res = query(dir, "SELECT COUNT(*)::INTEGER AS n FROM information_schema.tables WHERE table_name = 'evil'");
    expect(res.status, res.stderr).toBe(0);
    return res.stdout;
  };

  it("rejects multi-statement writes and leaves the database unchanged", () => {
    const dir = repo();
    const before = tableCount(dir);
    const dbTmp = join(dir, ".flaker", "data.tmp");
    for (const sql of [
      "SELECT 1; CREATE TABLE evil(a INT); CHECKPOINT",
      `SELECT 1; COPY (SELECT 1) TO '${join(dbTmp, "x.csv")}'`,
      "SELECT 1 /* /* */ ' */ ; CREATE TABLE evil(a INT); SELECT ''",
    ]) {
      const res = query(dir, sql);
      expect(res.status, sql).not.toBe(0);
    }
    expect(tableCount(dir)).toBe(before);
    expect(before).toMatch(/\b0\b/);
    expect(existsSync(join(dbTmp, "x.csv"))).toBe(false);
  });

  it("runs the documented examples", () => {
    const dir = repo();
    for (const sql of [
      "SELECT * FROM flaker_v1.flaky WHERE is_flaky",
      `SELECT suite, test_name, status, COUNT(*) as cnt
              FROM test_results
              GROUP BY suite, test_name, status
              ORDER BY cnt DESC
              LIMIT 20`,
      "SELECT * FROM test_results LIMIT 20",
      "SELECT 1 AS one;",
    ]) {
      const res = query(dir, sql);
      expect(res.status, `${sql}\n${res.stderr}`).toBe(0);
    }
  });
});
