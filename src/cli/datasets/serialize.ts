import type { JsonSchema } from "../contracts/json-schema.js";

type Prop = { type?: string | string[] };

function isStructured(prop: Prop | undefined): boolean {
  if (!prop?.type) return false;
  const types = Array.isArray(prop.type) ? prop.type : [prop.type];
  return types.includes("array") || types.includes("object");
}

/** DuckDB row → the JSON shape the dataset's schema describes. */
export function normalizeRow(row: Record<string, unknown>, schema: JsonSchema): Record<string, unknown> {
  const props = (schema.properties ?? {}) as Record<string, Prop>;
  const out: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    out[column] = normalizeValue(value, props[column]);
  }
  return out;
}

function normalizeValue(value: unknown, prop: Prop | undefined): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && isStructured(prop)) return JSON.parse(value);
  return value;
}
