// src/cli/contracts/json-schema.ts
/** A JSON Schema (draft 2020-12) as a plain object. */
export type JsonSchema = { [key: string]: unknown };

export const STR: JsonSchema = { type: "string" };
export const STR_OR_NULL: JsonSchema = { type: ["string", "null"] };
export const INT: JsonSchema = { type: "integer" };
export const INT_OR_NULL: JsonSchema = { type: ["integer", "null"] };
export const NUM: JsonSchema = { type: "number" };
export const NUM_OR_NULL: JsonSchema = { type: ["number", "null"] };
export const BOOL: JsonSchema = { type: "boolean" };
export const TIME: JsonSchema = { type: "string", format: "date-time" };
export const TIME_OR_NULL: JsonSchema = { type: ["string", "null"], format: "date-time" };
export const STRINGS: JsonSchema = { type: "array", items: { type: "string" } };
export const oneOf = (...values: string[]): JsonSchema => ({ type: "string", enum: values });
