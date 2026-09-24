// src/cli/contracts/jev-context-v1.ts
/**
 * `jev-context` v1: what flaker hands jev-test-filter (`--context <file>`).
 * Produced by `flaker export --projection jev-context`. A test is named by
 * file + title_path (+ project), never by jev's line-bearing testId.
 * `digest` = "sha256:" + sha256(canonical JSON of { skip, tests }).
 */
import { NUM, NUM_OR_NULL, INT, STR, STRINGS, TIME, type JsonSchema } from "./json-schema.js";

export interface JevContextGateV1 {
  cutoff: number;
  unsure_below: number;
  unsure_margin: number;
  basis: { records: number; real_failures: number; recall_lb95: number | null };
}
export interface JevContextNameV1 { file: string; title_path: string[]; project?: string }
export interface JevContextSkipV1 extends JevContextNameV1 { reason: "quarantined" }
export interface JevContextTestV1 extends JevContextNameV1 { failed_with: string[]; missed?: number }
export interface JevContextV1 {
  version: 1;
  digest: string;
  generated_at: string;
  gate: JevContextGateV1 | null;
  skip: JevContextSkipV1[];
  tests: JevContextTestV1[];
}

const NAME = { file: { type: "string", minLength: 1 }, title_path: STRINGS, project: STR };

export const JEV_CONTEXT_V1_SCHEMA: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/mizchi/flaker/contracts/jev-context-v1.json",
  title: "flaker jev-context v1",
  type: "object",
  required: ["version", "digest", "gate", "skip", "tests"],
  properties: {
    version: { const: 1 },
    digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    generated_at: TIME,
    gate: {
      type: ["object", "null"],
      required: ["cutoff", "unsure_below", "unsure_margin", "basis"],
      properties: {
        cutoff: NUM, unsure_below: NUM, unsure_margin: NUM,
        basis: {
          type: "object", required: ["records", "real_failures", "recall_lb95"],
          properties: { records: INT, real_failures: INT, recall_lb95: NUM_OR_NULL },
        },
      },
    },
    skip: {
      type: "array",
      items: { type: "object", required: ["file", "title_path", "reason"], properties: { ...NAME, reason: { const: "quarantined" } } },
    },
    tests: {
      type: "array",
      items: {
        type: "object", required: ["file", "title_path", "failed_with"],
        properties: { ...NAME, failed_with: { ...STRINGS, maxItems: 5 }, missed: INT },
      },
    },
  },
};
