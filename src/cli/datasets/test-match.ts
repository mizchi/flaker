/**
 * A selector names a test by file + title_path (+ project); flaker keys it
 * by test_key. Stable ids cannot be recomputed from the selector's name
 * because adapters spell suite / test_name / task_id differently, so the
 * name is matched against known tests in tiers. A tier wins only with
 * exactly one candidate; anything else is unmatched (null), never guessed.
 */
export interface KnownTest {
  test_key: string;
  file: string;
  title_path: string[];
  test_name: string;
  task_id: string;
  project: string | null;
}

export interface SelectorTestName {
  file: string;
  title_path: string[];
  project?: string | null;
  runner_file?: string | null;
}

export type TestIndex = Map<string, KnownTest[]>;

const normFile = (f: string) => f.replace(/^\.\//, "");
const normProject = (p: string | null | undefined) => (p ? p : null);
const bucket = (file: string, project: string | null) => `${normFile(file)}\u001e${project ?? ""}`;
const samePath = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((s, i) => s === b[i]);
/** A row stored before title paths were kept: no path, or just its test_name. */
const isLegacy = (t: KnownTest) => t.title_path.length === 0 || samePath(t.title_path, [t.test_name]);

export function buildTestIndex(tests: KnownTest[]): TestIndex {
  const index: TestIndex = new Map();
  for (const t of tests) {
    const key = bucket(t.file, normProject(t.project));
    const list = index.get(key);
    if (list) list.push(t);
    else index.set(key, [t]);
  }
  return index;
}

export function matchTestKey(index: TestIndex, name: SelectorTestName): string | null {
  const project = normProject(name.project);
  const files = [name.file, name.runner_file].filter((f): f is string => typeof f === "string" && f !== "");
  const candidates = [...new Set(files.map(normFile))].flatMap((f) => index.get(bucket(f, project)) ?? []);
  const path = name.title_path;
  const parent = path.length >= 2 ? path[path.length - 2] : null;
  const tiers: Array<(t: KnownTest) => boolean> = [
    (t) => samePath(t.title_path, path),
    // Tiers 2 and 3 only reconstruct a path a legacy row never stored. A row
    // with a real title path must match on it, or a new test would take the
    // key of a known one that happens to share its leaf or joined name.
    (t) => isLegacy(t) && t.test_name === path.join(" "),
    (t) => isLegacy(t) && t.test_name === path[path.length - 1] && (path.length === 1 || t.task_id === parent),
  ];
  for (const tier of tiers) {
    const hits = [...new Set(candidates.filter(tier).map((t) => t.test_key))];
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;
  }
  return null;
}
