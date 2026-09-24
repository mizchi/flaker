import { describe, expect, it } from "vitest";
import { assertReadOnlyQuery } from "../../src/cli/commands/analyze/sql-guard.js";
import { FlakerUsageError } from "../../src/cli/errors.js";

describe("assertReadOnlyQuery", () => {
  const accepted = [
    "SELECT * FROM flaker_v1.flaky WHERE is_flaky",
    `SELECT suite, test_name, status, COUNT(*) as cnt
              FROM test_results
              GROUP BY suite, test_name, status
              ORDER BY cnt DESC
              LIMIT 20`,
    "SELECT * FROM test_results LIMIT 20",
    "SELECT 1;",
    "SELECT 1;  \n",
    "SELECT 'a; CREATE TABLE x(a INT)' AS s",
    `SELECT 1 AS "a;b"`,
    "SELECT 1 -- trailing; comment",
    "SELECT 1 /* a; /* nested; */ still; */ AS a",
    "SELECT E'it\\'s; fine' AS s",
    "WITH x AS (SELECT 1 AS a) SELECT a FROM x",
    "-- leading comment\nSELECT 1",
  ];
  for (const sql of accepted) {
    it(`accepts ${JSON.stringify(sql).slice(0, 60)}`, () => {
      expect(() => assertReadOnlyQuery(sql)).not.toThrow();
    });
  }

  const rejected = [
    ["a second statement", "SELECT 1; CREATE TABLE evil(a INT)"],
    ["a CHECKPOINT after a SELECT", "SELECT 1; CHECKPOINT"],
    ["a COPY after a SELECT", "SELECT 1; COPY (SELECT 1) TO 'x.csv'"],
    ["a statement after a trailing comment", "SELECT 1 -- x\n; DROP TABLE t"],
    ["a ';' after a nested comment closes", "SELECT 1 /* /* */ ' */ ; DROP TABLE t; SELECT ''"],
    ["a ';' hidden by an E-string escape", "SELECT E'\\''; DROP TABLE t; SELECT ''"],
    ["a dollar-quoted string", "SELECT $$ ' $$; DROP TABLE t; SELECT ''"],
    ["an unterminated quote", "SELECT 'x"],
    ["an unterminated comment", "SELECT 1 /* x"],
    ["a write statement", "CREATE TABLE evil(a INT)"],
    ["a write behind a comment", "/* x */ INSERT INTO t VALUES (1)"],
    ["COPY", "COPY (SELECT 1) TO 'x.csv'"],
    ["a file table function", "SELECT * FROM read_csv('x.csv')"],
  ] as const;
  for (const [label, sql] of rejected) {
    it(`rejects ${label}`, () => {
      expect(() => assertReadOnlyQuery(sql)).toThrow(FlakerUsageError);
    });
  }

  it("does not mistake a file function name inside a string for a call", () => {
    expect(() => assertReadOnlyQuery("SELECT * FROM test_results WHERE test_name = 'read_csv(x)'")).not.toThrow();
  });
});
