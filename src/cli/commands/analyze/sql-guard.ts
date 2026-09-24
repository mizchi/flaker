import { FlakerUsageError } from "../../errors.js";

/** DuckDB table functions that read or write the filesystem or network. */
export const FILESYSTEM_FUNCTIONS =
  /\b(READ_CSV_AUTO|READ_CSV|READ_PARQUET|READ_JSON_AUTO|READ_JSON|READ_BLOB|READ_TEXT|WRITE_CSV|HTTPFS|GLOB)\s*\(/i;

/**
 * Words that start a statement, a subquery or a set operation, or that name a
 * function with effects outside the row. None can appear in a row filter.
 */
const FORBIDDEN_WORDS = new Set([
  "SELECT", "FROM", "TABLE", "VALUES", "WITH", "UNION", "INTERSECT", "EXCEPT",
  "PIVOT", "UNPIVOT", "SUMMARIZE", "DESCRIBE", "SHOW", "COPY", "ATTACH", "DETACH",
  "INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER", "TRUNCATE", "PRAGMA",
  "CALL", "SET", "RESET", "LOAD", "INSTALL", "EXPORT", "IMPORT", "EXECUTE", "PREPARE",
  "GETENV", "QUERY", "QUERY_TABLE",
]);

/**
 * A user-supplied SQL fragment (a WHERE condition): one row-level expression.
 *
 * The fragment is scanned outside string literals and quoted identifiers. It
 * may not contain `;`, comments, `\` or `$` (which would change how DuckDB
 * reads quotes), unbalanced parentheses, or any word in FORBIDDEN_WORDS. So it
 * cannot end the surrounding `WHERE (…)`, comment out the rest of the query,
 * or open a subquery: it can only refer to the selected dataset's columns.
 */
export function assertSafeSqlFragment(fragment: string, flag: string): void {
  const fail = (why: string): never => {
    throw new FlakerUsageError(`${flag} must be a condition over the dataset's columns: ${why}`);
  };
  if (/[\\$]/.test(fragment)) fail("'\\' and '$' are not allowed");
  let depth = 0;
  let outside = "";
  for (let i = 0; i < fragment.length; i++) {
    const ch = fragment[i];
    if (ch === "'" || ch === '"') {
      const end = fragment.indexOf(ch, i + 1);
      if (end < 0) fail("unterminated quote");
      // A doubled quote is an escaped quote: the scan simply resumes after it.
      i = end;
      outside += " ";
      continue;
    }
    if (ch === ";") fail("no ';'");
    if (ch === "-" && fragment[i + 1] === "-") fail("no comments");
    if (ch === "/" && fragment[i + 1] === "*") fail("no comments");
    if (ch === "(") depth++;
    if (ch === ")" && --depth < 0) fail("unbalanced ')'");
    outside += ch;
  }
  if (depth !== 0) fail("unbalanced '('");
  if (FILESYSTEM_FUNCTIONS.test(outside)) fail("no filesystem or network functions");
  for (const word of outside.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    if (FORBIDDEN_WORDS.has(word.toUpperCase())) fail(`'${word}' is not allowed`);
  }
}
