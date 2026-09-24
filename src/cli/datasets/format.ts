export const EXPORT_FORMATS = ["json", "jsonl", "csv", "parquet"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export type TextExportFormat = Exclude<ExportFormat, "parquet">;

export function isExportFormat(value: string): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value);
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows (already normalized) as text. `columns` fixes the CSV header, even for zero rows. */
export function formatRows(
  rows: Record<string, unknown>[],
  format: TextExportFormat,
  columns: string[],
): string {
  switch (format) {
    case "json":
      return `${JSON.stringify(rows, null, 2)}\n`;
    case "jsonl":
      return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : "");
    case "csv":
      return [columns.join(","), ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(","))]
        .join("\n") + "\n";
  }
}
