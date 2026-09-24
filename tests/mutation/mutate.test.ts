import { describe, expect, it } from "vitest";
import {
  applyMutation,
  findMutationSites,
  isMutableSourcePath,
  pickMutations,
} from "../../src/cli/mutation/mutate.js";

const summary = (source: string) =>
  findMutationSites(source).map((s) => `${s.line}:${s.kind}:${s.original.trim()}>${s.replacement.trim()}`);

describe("findMutationSites", () => {
  it("flips comparisons, logic and boolean returns", () => {
    const src = [
      "export function f(a, b) {",
      "  if (a === b && a !== 0) return true;",
      "  if (a < b || a >= 3) return false;",
      "  return a == b;",
      "}",
    ].join("\n");
    expect(summary(src)).toEqual([
      "1:early-return:{>{ return;",
      "2:compare:===>!==",
      "2:boolean:&&>||",
      "2:compare:!==>===",
      "2:boolean:return true>return false",
      "3:compare:<>>=",
      "3:boolean:||>&&",
      "3:compare:>=><",
      "3:boolean:return false>return true",
      "4:compare:==>!=",
    ]);
  });

  it("skips strings, template text, comments, generics and arrows", () => {
    const src = [
      "// a === b",
      "/* x && y */",
      "const s = 'a === b' + \"c || d\";",
      "const t = `x < y ${a === b ? 1 : 2} z && w`;",
      "const m: Map<string, Array<number>> = new Map();",
      "const g = (x) => x;",
    ].join("\n");
    expect(summary(src)).toEqual(["4:compare:===>!=="]);
  });

  it("inserts early returns only in function bodies", () => {
    const src = [
      "function a() {",
      "  if (x) {",
      "  }",
      "}",
      "const b = async () => {",
      "};",
      "class C {",
      "  method(x: number): string {",
      "    for (const y of z) {",
      "    }",
      "  }",
      "}",
    ].join("\n");
    expect(summary(src)).toEqual([
      "1:early-return:{>{ return;",
      "5:early-return:{>{ return;",
      "8:early-return:{>{ return;",
    ]);
  });

  it("applies a site and refuses a stale one", () => {
    const src = "const ok = a === b;\n";
    const [site] = findMutationSites(src);
    expect(applyMutation(src, site)).toBe("const ok = a !== b;\n");
    expect(() => applyMutation("changed", site)).toThrow(/does not match/);
  });
});

describe("pickMutations", () => {
  const files = [
    { path: "src/a.ts", content: "export const a = (x) => x === 1 && x !== 2;\n" },
    { path: "src/b.ts", content: "export function b() {\n  return true;\n}\n" },
    { path: "src/none.ts", content: "export const n = 1;\n" },
  ];

  it("is deterministic for a seed and spreads over files", () => {
    const one = pickMutations(files, 2, 7);
    expect(pickMutations(files, 2, 7)).toEqual(one);
    expect(new Set(one.map((m) => m.file))).toEqual(new Set(["src/a.ts", "src/b.ts"]));
  });

  it("stops when the sites run out", () => {
    expect(pickMutations(files, 100, 1)).toHaveLength(5);
  });
});

describe("isMutableSourcePath", () => {
  it("takes source files and leaves tests, declarations and build output", () => {
    expect(["src/a.ts", "lib/b.mjs", "c.tsx"].every(isMutableSourcePath)).toBe(true);
    expect(["src/a.test.ts", "tests/x.ts", "src/a.d.ts", "dist/a.js", "README.md", "src/__tests__/a.ts"].some(isMutableSourcePath)).toBe(false);
  });
});
