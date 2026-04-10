import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import {
  collectCoverage,
  formatCollectCoverageSummary,
} from "../../src/cli/commands/collect/coverage.js";

describe("collect coverage command", () => {
  let store: DuckDBStore;
  let inputDir: string;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
    inputDir = join(tmpdir(), `flaker-coverage-${Date.now()}`);
    mkdirSync(inputDir, { recursive: true });
  });

  afterEach(async () => {
    await store.close();
    rmSync(inputDir, { recursive: true, force: true });
  });

  it("reads coverage files from a directory and dedupes repeated edges", async () => {
    writeFileSync(
      join(inputDir, "a.json"),
      JSON.stringify({
        "tests/auth.test.ts > login": {
          "/project/src/auth.ts": {
            path: "/project/src/auth.ts",
            statementMap: {
              "0": { start: { line: 10, column: 0 }, end: { line: 10, column: 20 } },
            },
            s: { "0": 1 },
          },
        },
      }),
    );
    writeFileSync(
      join(inputDir, "b.json"),
      JSON.stringify({
        "tests/auth.test.ts > login": {
          "/project/src/auth.ts": {
            path: "/project/src/auth.ts",
            statementMap: {
              "0": { start: { line: 10, column: 0 }, end: { line: 10, column: 20 } },
              "1": { start: { line: 20, column: 0 }, end: { line: 20, column: 20 } },
            },
            s: { "0": 1, "1": 1 },
          },
        },
      }),
    );

    const result = await collectCoverage({
      store,
      format: "istanbul",
      input: inputDir,
      testIdPrefix: "dogfood",
    });

    expect(result).toEqual({
      testsProcessed: 1,
      edgesInserted: 2,
      sourceFiles: ["a", "b"],
    });

    const rows = await store.raw<{ suite: string; test_name: string; edge: string }>(
      "SELECT suite, test_name, edge FROM test_coverage ORDER BY edge",
    );
    expect(rows).toEqual([
      {
        suite: "tests/auth.test.ts > login",
        test_name: "tests/auth.test.ts > login",
        edge: "src/auth.ts:10",
      },
      {
        suite: "tests/auth.test.ts > login",
        test_name: "tests/auth.test.ts > login",
        edge: "src/auth.ts:20",
      },
    ]);
  });

  it("formats a compact coverage collection summary", () => {
    expect(formatCollectCoverageSummary({
      testsProcessed: 3,
      edgesInserted: 12,
      sourceFiles: ["a", "b"],
    })).toContain("Edges inserted:   12");
  });
});
