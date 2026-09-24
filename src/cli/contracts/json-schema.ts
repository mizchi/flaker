/** A JSON Schema (draft 2020-12) as a plain object. */
export type JsonSchema = { [key: string]: unknown };

export const STR: JsonSchema = { type: "string" };
export const STR_OR_NULL: JsonSchema = { type: ["string", "null"] };
export const INT: JsonSchema = { type: "integer" };
export const INT_OR_NULL: JsonSchema = { type: ["integer", "null"] };
export const NUM: JsonSchema = { type: "number" };
export const NUM_OR_NULL: JsonSchema = { type: ["number", "null"] };
export const BOOL: JsonSchema = { type: "boolean" };
/**
 * JSON Schema's `date-time`: RFC 3339, with a `Z` or a numeric offset. Parsers
 * check against this, and the contract tests give it to ajv as the format.
 */
export const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

export const TIME: JsonSchema = { type: "string", format: "date-time" };
export const TIME_OR_NULL: JsonSchema = { type: ["string", "null"], format: "date-time" };
export const STRINGS: JsonSchema = { type: "array", items: { type: "string" } };
export const oneOf = (...values: string[]): JsonSchema => ({ type: "string", enum: values });
