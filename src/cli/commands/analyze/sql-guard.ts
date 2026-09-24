import { FlakerUsageError } from "../../errors.js";

/**
 * DuckDB table functions that read or write files or the network, caught
 * lexically for a clear message. Not a sandbox: replacement scans
 * (`FROM 'file.csv'`) and PIVOT_* read files without any of these names, so
 * callers that run user SQL also turn off external access
 * (`DuckDBStore.disableExternalAccess`).
 */
export const FILESYSTEM_FUNCTIONS =
  /\b(READ_\w+|WRITE_\w+|SNIFF_CSV|PARQUET_\w+|ICEBERG_\w+|DELTA_SCAN|GLOB|HTTPFS|SQLITE_\w+|POSTGRES_\w+|MYSQL_\w+)\s*\(/i;

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

type Json = { [key: string]: unknown };
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isEmpty = (v: unknown) => v === null || v === undefined || (Array.isArray(v) && v.length === 0);

/** Keys that only appear on a node that reads a relation. */
const RELATION_KEYS = new Set(["subquery", "node", "from_table", "source", "table_name", "function"]);

function findRelation(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRelation(item);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(value)) return null;
  if (value.class === "SUBQUERY" || value.type === "SUBQUERY") return "subqueries are not allowed";
  for (const [key, child] of Object.entries(value)) {
    if (RELATION_KEYS.has(key) && child !== null) return `subqueries and table references are not allowed (${key})`;
    const found = findRelation(child);
    if (found) return found;
  }
  return null;
}

/**
 * The structural gate for `--where`: `tree` is DuckDB's `json_serialize_sql`
 * of `SELECT * FROM flaker_v1.<dataset> WHERE (…)`. It must be exactly one
 * plain SELECT * over that view, and its WHERE expression must not contain a
 * subquery or any relation. The lexical `assertSafeSqlFragment` runs first for
 * readable errors; this check is what holds when a grammar slips past it
 * (PIVOT_WIDER / PIVOT_LONGER open a subquery without SELECT, FROM or TABLE).
 */
export function assertRowFilterTree(tree: unknown, dataset: string, flag: string): void {
  const fail = (why: string): never => {
    throw new FlakerUsageError(`${flag} must be a condition over the dataset's columns: ${why}`);
  };
  if (!isObject(tree) || tree.error !== false) fail("DuckDB does not read it as a single SELECT filter");
  const statements = (tree as Json).statements;
  if (!Array.isArray(statements) || statements.length !== 1) fail("one condition only");
  const node = (statements as Json[])[0]?.node;
  if (!isObject(node) || node.type !== "SELECT_NODE") fail("it turns the query into something other than a SELECT");
  const n = node as Json;
  const cte = isObject(n.cte_map) ? n.cte_map.map : n.cte_map;
  if (!isEmpty(n.modifiers) || !isEmpty(cte) || !isEmpty(n.group_expressions) || !isEmpty(n.group_sets)
    || !isEmpty(n.having) || !isEmpty(n.qualify) || !isEmpty(n.sample)) {
    fail("it changes the query around the condition");
  }
  const select = n.select_list;
  const star = Array.isArray(select) && select.length === 1 && isObject(select[0]) ? select[0] : null;
  if (!star || star.class !== "STAR" || star.columns !== false || star.expr !== null || star.relation_name !== ""
    || !isEmpty(star.exclude_list) || !isEmpty(star.replace_list) || !isEmpty(star.rename_list)
    || !isEmpty(star.qualified_exclude_list)) {
    fail("it changes the selected columns");
  }
  const from = n.from_table;
  if (!isObject(from) || from.type !== "BASE_TABLE" || from.schema_name !== "flaker_v1" || from.table_name !== dataset
    || (from.catalog_name ?? "") !== "" || !isEmpty(from.sample) || !isEmpty(from.at_clause) || from.alias !== "") {
    fail(`it reads something other than flaker_v1.${dataset}`);
  }
  const relation = findRelation(n.where_clause);
  if (relation) fail(relation);
}
