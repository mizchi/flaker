import { describe, it, expect, beforeAll } from "vitest";
import type { DependencyGraph, GraphNode } from "../../src/cli/graph/types.js";
import { loadCore, type FlakerCore } from "../../src/cli/core/loader.js";

let core: FlakerCore;

function makeGraph(nodes: GraphNode[]): DependencyGraph {
  const map = new Map<string, GraphNode>();
  for (const n of nodes) map.set(n.id, n);
  return { nodes: map, rootDir: "/tmp" };
}

function node(id: string, deps: string[] = [], path?: string): GraphNode {
  return {
    id,
    path: path ?? id,
    dependencies: deps,
    sourcePatterns: [`${id}/src/**`],
    testPatterns: [`${id}/tests/**`],
  };
}

beforeAll(async () => {
  core = await loadCore();
});

describe("Complex graph patterns (MoonBit bridge)", () => {
  describe("Diamond dependency (A → B,C → D)", () => {
    const graph = makeGraph([
      node("A", ["B", "C"]),
      node("B", ["D"]),
      node("C", ["D"]),
      node("D"),
    ]);

    it("topological sort: D before B,C before A", () => {
      const order = core.topologicalSort(graph);
      const idx = (id: string) => order.indexOf(id);
      expect(idx("D")).toBeLessThan(idx("B"));
      expect(idx("D")).toBeLessThan(idx("C"));
      expect(idx("B")).toBeLessThan(idx("A"));
      expect(idx("C")).toBeLessThan(idx("A"));
    });

    it("change in D affects all nodes", () => {
      const affected = core.findAffectedNodes(graph, ["D/src/core.ts"]);
      expect(affected).toContain("D");
      expect(affected).toContain("B");
      expect(affected).toContain("C");
      expect(affected).toContain("A");
      expect(affected).toHaveLength(4);
    });

    it("change in B affects only B and A", () => {
      const affected = core.findAffectedNodes(graph, ["B/src/util.ts"]);
      expect(affected).toContain("B");
      expect(affected).toContain("A");
      expect(affected).not.toContain("C");
      expect(affected).not.toContain("D");
    });
  });

  describe("Long chain (A → B → C → D → E)", () => {
    const graph = makeGraph([
      node("A", ["B"]),
      node("B", ["C"]),
      node("C", ["D"]),
      node("D", ["E"]),
      node("E"),
    ]);

    it("topological sort respects all dependencies", () => {
      const order = core.topologicalSort(graph);
      for (let i = 0; i < order.length - 1; i++) {
        const current = graph.nodes.get(order[i])!;
        for (const dep of current.dependencies) {
          expect(order.indexOf(dep)).toBeLessThan(i);
        }
      }
    });

    it("change in E propagates through entire chain", () => {
      const affected = core.findAffectedNodes(graph, ["E/src/base.ts"]);
      expect(affected).toHaveLength(5);
    });

    it("change in C affects C, B, A only", () => {
      const affected = core.findAffectedNodes(graph, ["C/src/mid.ts"]);
      expect(affected).toEqual(expect.arrayContaining(["C", "B", "A"]));
      expect(affected).not.toContain("D");
      expect(affected).not.toContain("E");
    });
  });

  describe("Fan-out / Fan-in (root → A,B,C,D → sink)", () => {
    const graph = makeGraph([
      node("root", ["A", "B", "C", "D"]),
      node("A", ["sink"]),
      node("B", ["sink"]),
      node("C", ["sink"]),
      node("D", ["sink"]),
      node("sink"),
    ]);

    it("topological sort: sink first, root last", () => {
      const order = core.topologicalSort(graph);
      expect(order[0]).toBe("sink");
      expect(order[order.length - 1]).toBe("root");
    });

    it("change in sink affects everything", () => {
      const affected = core.findAffectedNodes(graph, ["sink/src/x.ts"]);
      expect(affected).toHaveLength(6);
    });

    it("change in A affects only A and root", () => {
      const affected = core.findAffectedNodes(graph, ["A/src/x.ts"]);
      expect(affected).toHaveLength(2);
      expect(affected).toContain("A");
      expect(affected).toContain("root");
    });
  });

  describe("Isolated nodes (no dependencies)", () => {
    const graph = makeGraph([
      node("X"),
      node("Y"),
      node("Z"),
    ]);

    it("topological sort returns all nodes", () => {
      const order = core.topologicalSort(graph);
      expect(order).toHaveLength(3);
    });

    it("change in X affects only X", () => {
      const affected = core.findAffectedNodes(graph, ["X/src/x.ts"]);
      expect(affected).toEqual(["X"]);
    });

    it("reverse deps map is empty for isolated nodes", () => {
      const reverse = core.buildReverseDeps(graph);
      for (const [_, deps] of reverse) {
        expect(deps).toHaveLength(0);
      }
    });
  });

  describe("Multiple roots", () => {
    const graph = makeGraph([
      node("app1", ["shared"]),
      node("app2", ["shared"]),
      node("shared", ["core"]),
      node("core"),
      node("standalone"),
    ]);

    it("change in core affects core, shared, app1, app2", () => {
      const affected = core.findAffectedNodes(graph, ["core/src/x.ts"]);
      expect(affected).toHaveLength(4);
      expect(affected).not.toContain("standalone");
    });

    it("change in standalone affects only standalone", () => {
      const affected = core.findAffectedNodes(graph, ["standalone/src/x.ts"]);
      expect(affected).toEqual(["standalone"]);
    });
  });

  describe("Cycle detection", () => {
    const graph = makeGraph([
      node("A", ["B"]),
      node("B", ["C"]),
      node("C", ["A"]),
    ]);

    it("topological sort handles cycles without infinite loop", () => {
      const order = core.topologicalSort(graph);
      expect(order).toHaveLength(3);
    });

    it("affected expansion handles cycles without infinite loop", () => {
      const affected = core.findAffectedNodes(graph, ["A/src/x.ts"]);
      expect(affected).toHaveLength(3);
    });
  });

  describe("Large graph (20 nodes)", () => {
    const nodes: GraphNode[] = [
      node("core"),
      node("utils", ["core"]),
      node("types", ["core"]),
      node("db", ["core", "types"]),
      node("auth", ["utils", "db"]),
      node("api", ["auth", "db", "types"]),
      node("web-components", ["utils", "types"]),
      node("web-app", ["api", "web-components"]),
      node("mobile-app", ["api", "web-components"]),
      node("admin", ["api", "web-components"]),
      node("cli", ["api", "utils"]),
      node("sdk", ["api", "types"]),
      node("docs", ["sdk"]),
      node("e2e-tests", ["web-app", "api"]),
      node("integration-tests", ["api", "db"]),
      node("benchmarks", ["core", "db"]),
      node("analytics", ["db", "types"]),
      node("notifications", ["auth", "utils"]),
      node("payments", ["auth", "db", "analytics"]),
      node("reporting", ["analytics", "payments"]),
    ];
    const graph = makeGraph(nodes);

    it("topological sort respects all dependencies", () => {
      const order = core.topologicalSort(graph);
      expect(order).toHaveLength(20);
      for (const n of nodes) {
        const idx = order.indexOf(n.id);
        for (const dep of n.dependencies) {
          expect(order.indexOf(dep)).toBeLessThan(idx);
        }
      }
    });

    it("change in core affects most nodes", () => {
      const affected = core.findAffectedNodes(graph, ["core/src/x.ts"]);
      expect(affected.length).toBeGreaterThan(15);
    });

    it("change in reporting affects only reporting", () => {
      const affected = core.findAffectedNodes(graph, ["reporting/src/x.ts"]);
      expect(affected).toEqual(["reporting"]);
    });

    it("change in auth affects auth + dependents", () => {
      const affected = core.findAffectedNodes(graph, ["auth/src/x.ts"]);
      expect(affected).toContain("auth");
      expect(affected).toContain("api");
      expect(affected).toContain("notifications");
      expect(affected).toContain("payments");
      expect(affected).toContain("web-app");
      expect(affected).not.toContain("core");
    });
  });
});
