// src/cli/projections/jev-context.ts
import { canonicalJson, sha256Hex } from "../contracts/canonical-json.js";
import type {
  JevContextNameV1, JevContextSkipV1, JevContextTestV1, JevContextV1,
} from "../contracts/jev-context-v1.js";

export const MAX_FILES_PER_TEST = 5;
export const DEFAULT_MAX_HINTED_TESTS = 200;
/** One co-failure on a multi-file commit cannot tell the file from its siblings. */
export const MIN_CO_FAILURES_FOR_HINT = 2;

export interface JevContextInput {
  tests: Array<{ test_key: string; file: string; title_path: string[]; variant: Record<string, string> | null }>;
  quarantine: Array<{ test_key: string }>;
  flaky: Array<{ test_key: string; is_flaky: boolean }>;
  /** flaker_v1.misses: already one row per (latest real selector run on a head, test). */
  misses: Array<{ test_key: string; selector_run_id: string; head_sha: string }>;
  co_failures: Array<{ changed_file: string; test_key: string; co_failures: number; strength: number }>;
  gate: {
    cutoff: number; unsure_below: number; unsure_margin: number;
    records: number; real_failures: number; recall_lb95: number | null;
  } | null;
  generatedAt: string;
  limits?: { maxFilesPerTest?: number; maxHintedTests?: number; minCoFailures?: number };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const nameKey = (n: JevContextNameV1) => `${n.file}\u001f${n.title_path.join("\u001f")}\u001e${n.project ?? ""}`;

export function buildJevContext(input: JevContextInput): JevContextV1 {
  const maxFiles = input.limits?.maxFilesPerTest ?? MAX_FILES_PER_TEST;
  const maxTests = input.limits?.maxHintedTests ?? DEFAULT_MAX_HINTED_TESTS;
  const minCo = input.limits?.minCoFailures ?? MIN_CO_FAILURES_FOR_HINT;

  const names = new Map<string, JevContextNameV1>();
  for (const t of input.tests) {
    const project = t.variant?.project;
    names.set(t.test_key, { file: t.file, title_path: [...t.title_path], ...(project ? { project } : {}) });
  }
  const quarantined = new Set(input.quarantine.map((q) => q.test_key));
  const flaky = new Set(input.flaky.filter((f) => f.is_flaky).map((f) => f.test_key));

  const skipByName = new Map<string, JevContextSkipV1>();
  for (const key of quarantined) {
    const n = names.get(key);
    if (n) skipByName.set(nameKey(n), { ...n, reason: "quarantined" });
  }
  const skip: JevContextSkipV1[] = [...skipByName.values()].sort((a, b) => cmp(nameKey(a), nameKey(b)));

  // Misses count per head: one commit is one piece of evidence.
  const missed = new Map<string, Set<string>>();
  for (const m of input.misses) {
    const set = missed.get(m.test_key) ?? new Set<string>();
    set.add(m.head_sha);
    missed.set(m.test_key, set);
  }
  const hints = new Map<string, Array<{ file: string; co: number; strength: number }>>();
  for (const c of input.co_failures) {
    if (c.co_failures < minCo) continue;
    const list = hints.get(c.test_key) ?? [];
    list.push({ file: c.changed_file, co: c.co_failures, strength: c.strength });
    hints.set(c.test_key, list);
  }

  // jev names a test by file + title_path (+ project), so test_keys that share
  // a name (other variant keys) merge into one entry before ranking: misses
  // add up, failed_with keeps each file once at its strongest. A name with a
  // quarantined key is in skip already; flaky keys contribute nothing.
  const quarantinedNames = new Set([...quarantined].flatMap((key) => {
    const n = names.get(key);
    return n ? [nameKey(n)] : [];
  }));
  const merged = new Map<string, { name: JevContextNameV1; missed: number; files: Map<string, { co: number; strength: number }> }>();
  for (const key of [...new Set([...missed.keys(), ...hints.keys()])].sort(cmp)) {
    const name = names.get(key);
    if (!name || flaky.has(key) || quarantined.has(key) || quarantinedNames.has(nameKey(name))) continue;
    const entry = merged.get(nameKey(name)) ?? { name, missed: 0, files: new Map() };
    entry.missed += missed.get(key)?.size ?? 0;
    for (const h of hints.get(key) ?? []) {
      const prev = entry.files.get(h.file);
      if (!prev || h.strength > prev.strength || (h.strength === prev.strength && h.co > prev.co)) {
        entry.files.set(h.file, { co: h.co, strength: h.strength });
      }
    }
    merged.set(nameKey(name), entry);
  }

  const candidates = [...merged.values()]
    .map((entry) => {
      const files = [...entry.files.entries()]
        .map(([file, v]) => ({ file, ...v }))
        .sort((a, b) => b.strength - a.strength || b.co - a.co || cmp(a.file, b.file));
      return {
        name: entry.name,
        missed: entry.missed,
        best: files[0]?.strength ?? 0,
        failedWith: files.slice(0, maxFiles).map((f) => f.file),
      };
    })
    .filter((c) => c.missed > 0 || c.failedWith.length > 0)
    .sort((a, b) => b.missed - a.missed || b.best - a.best || cmp(nameKey(a.name), nameKey(b.name)))
    .slice(0, maxTests);

  const tests: JevContextTestV1[] = candidates.map((c) => ({
    ...c.name,
    failed_with: c.failedWith,
    ...(c.missed > 0 ? { missed: c.missed } : {}),
  }));

  return {
    version: 1,
    digest: `sha256:${sha256Hex(canonicalJson({ skip, tests }))}`,
    generated_at: input.generatedAt,
    gate: input.gate === null ? null : {
      cutoff: input.gate.cutoff,
      unsure_below: input.gate.unsure_below,
      unsure_margin: input.gate.unsure_margin,
      basis: { records: input.gate.records, real_failures: input.gate.real_failures, recall_lb95: input.gate.recall_lb95 },
    },
    skip,
    tests,
  };
}
