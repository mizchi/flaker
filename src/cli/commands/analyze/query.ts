import type { MetricStore } from "../../storage/types.js";

export async function runQuery(store: MetricStore, sql: string): Promise<unknown[]> {
  return store.raw(sql);
}

export function formatQueryResult(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) {
    return "No results.";
  }

  const headers = Object.keys(rows[0]);
  const stringRows = rows.map((row) =>
    headers.map((h) => String(row[h] ?? "")),
  );

  const allRows = [headers, ...stringRows];
  const colWidths = headers.map((_, i) =>
    Math.max(...allRows.map((row) => (row[i] ?? "").length)),
  );

  const sep = colWidths.map((w) => "-".repeat(w)).join(" | ");
  const formatRow = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(colWidths[i])).join(" | ");

  const lines = [formatRow(headers), sep, ...stringRows.map(formatRow)];
  return lines.join("\n");
}
