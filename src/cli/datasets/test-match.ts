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
    (t) => t.test_name === path.join(" "),
    (t) => t.test_name === path[path.length - 1] && (path.length === 1 || t.task_id === parent),
  ];
  for (const tier of tiers) {
    const hits = [...new Set(candidates.filter(tier).map((t) => t.test_key))];
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;
  }
  return null;
}
