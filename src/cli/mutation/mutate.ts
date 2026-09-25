// src/cli/mutation/mutate.ts
/**
 * Source mutations for `flaker calibrate --mutate`, as pure functions over
 * JS/TS text. Three kinds, the ones the test-DB design names:
 *
 * - `compare`: flip a comparison (`===` ↔ `!==`, `==` ↔ `!=`, and a spaced
 *   ` < ` ↔ ` >= `, ` > ` ↔ ` <= `; unspaced `<` / `>` are left alone because
 *   they are usually generics or JSX);
 * - `boolean`: flip a boolean return (`return true` ↔ `return false`) or a
 *   logical operator (`&&` ↔ `||`);
 * - `early-return`: insert `return;` at the start of a function body.
 *
 * Strings, template literals and comments are skipped, so a mutation always
 * lands in code. The result is not type-checked: a runner that type-checks
 * will count a type error as a kill, like any other failure.
 */

export type MutationKind = "compare" | "boolean" | "early-return";

export interface MutationSite {
  kind: MutationKind;
  /** Offset into the source where `original` starts. */
  offset: number;
  /** 1-based line of `offset`. */
  line: number;
  original: string;
  replacement: string;
}

export interface Mutation extends MutationSite {
  file: string;
}

const FLIPS: Array<[string, string, MutationKind]> = [
  ["===", "!==", "compare"],
  ["!==", "===", "compare"],
  [" <= ", " > ", "compare"],
  [" >= ", " < ", "compare"],
  ["==", "!=", "compare"],
  ["!=", "==", "compare"],
  [" < ", " >= ", "compare"],
  [" > ", " <= ", "compare"],
  ["&&", "||", "boolean"],
  ["||", "&&", "boolean"],
];

const RETURN_BOOL = /^return\s+(true|false)\b/;
/** A line ending in `{` that opens a function body, not a block of a statement. */
const FUNCTION_OPEN = /(\bfunction\b[^{]*\)|=>|^\s*(?:(?:public|private|protected|static|async|override)\s+)*[A-Za-z_$][\w$]*\s*\([^)]*\)(?:\s*:\s*[^{]+)?)\s*\{\s*$/;
const STATEMENT_OPEN = /^\s*(?:\}\s*)?(?:if|else|for|while|switch|catch|do|try|with)\b/;

/**
 * The offsets of the source that are code: not inside a string, a template
 * literal (its `${…}` expressions count as code) or a comment.
 */
function codeMask(source: string): boolean[] {
  const mask = new Array<boolean>(source.length).fill(false);
  // Template nesting: each entry is the brace depth at which a `${` opened.
  const templates: number[] = [];
  let depth = 0;
  let i = 0;
  const inTemplateText = () => templates.length > 0 && templates[templates.length - 1] === -1;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (inTemplateText()) {
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { templates.pop(); i++; continue; }
      if (c === "$" && next === "{") { templates[templates.length - 1] = depth; depth++; i += 2; continue; }
      i++;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (c === "'" || c === "\"") {
      i++;
      while (i < source.length && source[i] !== c && source[i] !== "\n") i += source[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "`") { templates.push(-1); i++; continue; }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (templates.length > 0 && templates[templates.length - 1] === depth) {
        templates[templates.length - 1] = -1;
        i++;
        continue;
      }
    }
    mask[i] = true;
    i++;
  }
  return mask;
}

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

function allCode(mask: boolean[], from: number, length: number): boolean {
  for (let i = from; i < from + length; i++) if (!mask[i]) return false;
  return true;
}

/** Every place in `source` one mutation can go, in source order. */
export function findMutationSites(source: string): MutationSite[] {
  const mask = codeMask(source);
  const sites: MutationSite[] = [];
  const taken = new Array<boolean>(source.length).fill(false);
  const add = (kind: MutationKind, offset: number, original: string, replacement: string) => {
    for (let i = offset; i < offset + original.length; i++) if (taken[i]) return;
    for (let i = offset; i < offset + original.length; i++) taken[i] = true;
    sites.push({ kind, offset, line: 0, original, replacement });
  };

  // Longer operators first, so `===` is not also read as `==`.
  for (const [from, to, kind] of FLIPS) {
    for (let at = source.indexOf(from); at !== -1; at = source.indexOf(from, at + 1)) {
      if (!allCode(mask, at, from.length)) continue;
      // `==` / `!=` inside `===` / `!==`, and `=>`, `<=`/`>=` next to `=`.
      if ((from === "==" || from === "!=") && (source[at + 2] === "=" || source[at - 1] === "=" || source[at - 1] === "!")) continue;
      if ((from === " < " || from === " > ") && source[at + 3] === "=") continue;
      add(kind, at, from, to);
    }
  }
  for (let at = source.indexOf("return"); at !== -1; at = source.indexOf("return", at + 1)) {
    if (!mask[at] || /[\w$]/.test(source[at - 1] ?? "")) continue;
    const m = RETURN_BOOL.exec(source.slice(at));
    if (!m || !allCode(mask, at, m[0].length)) continue;
    add("boolean", at, m[0], m[0].replace(m[1], m[1] === "true" ? "false" : "true"));
  }
  let lineStart = 0;
  for (const text of source.split("\n")) {
    const brace = lineStart + text.lastIndexOf("{");
    if (text.trimEnd().endsWith("{") && mask[brace] && FUNCTION_OPEN.test(text) && !STATEMENT_OPEN.test(text)
      && !/\b(class|interface|enum|namespace|module|type)\b/.test(text)) {
      add("early-return", brace, "{", "{ return;");
    }
    lineStart += text.length + 1;
  }
  sites.sort((a, b) => a.offset - b.offset);
  for (const s of sites) s.line = lineAt(source, s.offset);
  return sites;
}

export function applyMutation(source: string, site: MutationSite): string {
  if (source.slice(site.offset, site.offset + site.original.length) !== site.original) {
    throw new Error(`mutation site at ${site.line} does not match the source`);
  }
  return source.slice(0, site.offset) + site.replacement + source.slice(site.offset + site.original.length);
}

/** A small seeded PRNG (mulberry32), so a seed picks the same mutations. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Up to `count` mutations spread over `files`: files are visited round-robin in
 * a seeded order, and each takes a seeded site it has not used yet.
 */
export function pickMutations(files: Array<{ path: string; content: string }>, count: number, seed: number): Mutation[] {
  const random = rng(seed);
  const pools = files
    .map((f) => ({ path: f.path, sites: findMutationSites(f.content) }))
    .filter((p) => p.sites.length > 0)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (let i = pools.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pools[i], pools[j]] = [pools[j], pools[i]];
  }
  const out: Mutation[] = [];
  while (out.length < count && pools.some((p) => p.sites.length > 0)) {
    for (const pool of pools) {
      if (out.length >= count) break;
      if (pool.sites.length === 0) continue;
      const [site] = pool.sites.splice(Math.floor(random() * pool.sites.length), 1);
      out.push({ ...site, file: pool.path });
    }
  }
  return out;
}

export function describeMutation(m: Mutation): string {
  return `${m.file}:${m.line} ${m.kind}: ${JSON.stringify(m.original.trim())} → ${JSON.stringify(m.replacement.trim())}`;
}

/** Source files a mutation may go in: JS/TS, not a test, not a declaration file. */
export function isMutableSourcePath(path: string): boolean {
  if (!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) || /\.d\.[cm]?ts$/.test(path)) return false;
  if (/\.(?:test|spec)\.[^/]+$/.test(path)) return false;
  return !/(^|\/)(?:tests?|__tests__|__mocks__|fixtures|node_modules|dist|build)\//.test(path);
}
