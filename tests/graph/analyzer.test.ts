import { describe, it, expect, beforeAll } from "vitest";
import type { DependencyGraph, GraphNode } from "../../src/cli/graph/types.js";
import { loadCore, type FlakerCore } from "../../src/cli/core/loader.js";

let core: FlakerCore;

function makeNode(partial: Partial<GraphNode> & { id: string }): GraphNode {
  return {
    path: partial.path ?? partial.id,
    dependencies: partial.dependencies ?? [],
    sourcePatterns: partial.sourcePatterns ?? [],
    testPatterns: partial.testPatterns ?? [],
    ...partial,
  };
}

function makeGraph(nodes: GraphNode[], rootDir = "/root"): DependencyGraph {
  const map = new Map<string, GraphNode>();
  for (const n of nodes) map.set(n.id, n);
  return { nodes: map, rootDir };
}

beforeAll(async () => {
  core = await loadCore();
});

describe("findAffectedNodes (MoonBit bridge)", () => {
  it("finds directly affected nodes by file path", () => {
    const graph = makeGraph([
      makeNode({ id: "pkg-a", path: "packages/a" }),
      makeNode({ id: "pkg-b", path: "packages/b" }),
    ]);
    const result = core.findAffectedNodes(graph, ["packages/a/src/index.ts"]);
    expect(result).toEqual(["pkg-a"]);
  });

  it("expands transitive dependents", () => {
    const graph = makeGraph([
      makeNode({ id: "core", path: "packages/core" }),
      makeNode({
        id: "app",
        path: "packages/app",
        dependencies: ["core"],
      }),
    ]);
    const result = core.findAffectedNodes(graph, ["packages/core/src/lib.ts"]);
    expect(result.sort()).toEqual(["app", "core"]);
  });

  it("handles deep transitive chains", () => {
    const graph = makeGraph([
      makeNode({ id: "a", path: "a" }),
      makeNode({ id: "b", path: "b", dependencies: ["a"] }),
      makeNode({ id: "c", path: "c", dependencies: ["b"] }),
    ]);
    const result = core.findAffectedNodes(graph, ["a/index.ts"]);
    expect(result.sort()).toEqual(["a", "b", "c"]);
  });

  it("returns empty for no matches", () => {
    const graph = makeGraph([makeNode({ id: "x", path: "packages/x" })]);
    const result = core.findAffectedNodes(graph, ["unrelated/file.ts"]);
    expect(result).toEqual([]);
  });
});

describe("expandTransitive (MoonBit bridge)", () => {
  it("follows reverse dependencies", () => {
    const graph = makeGraph([
      makeNode({ id: "lib", path: "lib" }),
      makeNode({ id: "app1", path: "app1", dependencies: ["lib"] }),
      makeNode({ id: "app2", path: "app2", dependencies: ["lib"] }),
      makeNode({ id: "unrelated", path: "other" }),
    ]);
    const result = core.expandTransitive(graph, new Set(["lib"]));
    expect(result.sort()).toEqual(["app1", "app2", "lib"]);
  });
});

describe("buildReverseDeps (MoonBit bridge)", () => {
  it("builds correct reverse dependency map", () => {
    const graph = makeGraph([
      makeNode({ id: "a", path: "a" }),
      makeNode({ id: "b", path: "b", dependencies: ["a"] }),
      makeNode({ id: "c", path: "c", dependencies: ["a", "b"] }),
    ]);
    const reverse = core.buildReverseDeps(graph);
    expect(reverse.get("a")?.sort()).toEqual(["b", "c"]);
    expect(reverse.get("b")).toEqual(["c"]);
    expect(reverse.has("c")).toBe(false);
  });
});

describe("topologicalSort (MoonBit bridge)", () => {
  it("produces valid topological order", () => {
    const graph = makeGraph([
      makeNode({ id: "c", path: "c", dependencies: ["b"] }),
      makeNode({ id: "a", path: "a" }),
      makeNode({ id: "b", path: "b", dependencies: ["a"] }),
    ]);
    const result = core.topologicalSort(graph);
    expect(result.indexOf("a")).toBeLessThan(result.indexOf("b"));
    expect(result.indexOf("b")).toBeLessThan(result.indexOf("c"));
  });

  it("handles independent nodes", () => {
    const graph = makeGraph([
      makeNode({ id: "x", path: "x" }),
      makeNode({ id: "y", path: "y" }),
    ]);
    const result = core.topologicalSort(graph);
    expect(result.sort()).toEqual(["x", "y"]);
  });
});

describe("getAffectedTestPatterns (MoonBit bridge)", () => {
  it("collects test patterns from affected nodes", () => {
    const graph = makeGraph([
      makeNode({
        id: "a",
        path: "a",
        testPatterns: ["a/tests/**/*.test.ts"],
      }),
      makeNode({
        id: "b",
        path: "b",
        testPatterns: ["b/tests/**/*.test.ts", "b/tests/**/*.spec.ts"],
      }),
      makeNode({ id: "c", path: "c", testPatterns: ["c/tests/**/*.test.ts"] }),
    ]);
    const result = core.getAffectedTestPatterns(graph, ["a", "b"]);
    expect(result).toEqual([
      "a/tests/**/*.test.ts",
      "b/tests/**/*.test.ts",
      "b/tests/**/*.spec.ts",
    ]);
  });

  it("returns empty for no affected nodes", () => {
    const graph = makeGraph([
      makeNode({ id: "a", path: "a", testPatterns: ["a/**/*.test.ts"] }),
    ]);
    const result = core.getAffectedTestPatterns(graph, []);
    expect(result).toEqual([]);
  });
});

describe("empty graph (MoonBit bridge)", () => {
  it("returns empty results for all operations", () => {
    const graph = makeGraph([]);
    expect(core.findAffectedNodes(graph, ["any/file.ts"])).toEqual([]);
    expect(core.expandTransitive(graph, new Set())).toEqual([]);
    expect(core.topologicalSort(graph)).toEqual([]);
    expect(core.getAffectedTestPatterns(graph, [])).toEqual([]);
  });
});
