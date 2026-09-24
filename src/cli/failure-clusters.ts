import type { TestCoFailurePair } from "./storage/types.js";

export interface FailureClusterMember {
  testId: string;
  taskId: string;
  suite: string;
  testName: string;
  filter: string | null;
  failRuns: number;
}

export interface FailureCluster {
  id: string;
  members: FailureClusterMember[];
  edges: TestCoFailurePair[];
  maxCoFailRate: number;
  avgCoFailRate: number;
  totalCoFailRuns: number;
}

const DEFAULT_CLUSTER_QUERY = {
  windowDays: 90,
  minCoFailures: 2,
  minCoRate: 0.8,
} as const;

export function getDefaultClusterQuery(): typeof DEFAULT_CLUSTER_QUERY {
  return DEFAULT_CLUSTER_QUERY;
}

function compareMembers(
  a: FailureClusterMember,
  b: FailureClusterMember,
): number {
  return b.failRuns - a.failRuns
    || a.suite.localeCompare(b.suite)
    || a.testName.localeCompare(b.testName);
}

export function buildFailureClusters(
  pairs: TestCoFailurePair[],
): FailureCluster[] {
  const membersById = new Map<string, FailureClusterMember>();
  const adjacency = new Map<string, string[]>();

  const ensureMember = (
    testId: string,
    taskId: string,
    suite: string,
    testName: string,
    filter: string | null,
    failRuns: number,
  ) => {
    if (!membersById.has(testId)) {
      membersById.set(testId, {
        testId,
        taskId,
        suite,
        testName,
        filter,
        failRuns,
      });
    }
    if (!adjacency.has(testId)) {
      adjacency.set(testId, []);
    }
  };

  for (const pair of pairs) {
    ensureMember(
      pair.testAId,
      pair.testATaskId,
      pair.testASuite,
      pair.testATestName,
      pair.testAFilter,
      pair.testAFailRuns,
    );
    ensureMember(
      pair.testBId,
      pair.testBTaskId,
      pair.testBSuite,
      pair.testBTestName,
      pair.testBFilter,
      pair.testBFailRuns,
    );
    adjacency.get(pair.testAId)!.push(pair.testBId);
    adjacency.get(pair.testBId)!.push(pair.testAId);
  }

  const visited = new Set<string>();
  const clusters: Omit<FailureCluster, "id">[] = [];

  for (const testId of membersById.keys()) {
    if (visited.has(testId)) {
      continue;
    }

    const stack = [testId];
    const component: string[] = [];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) {
          stack.push(next);
        }
      }
    }

    if (component.length < 2) {
      continue;
    }

    const componentSet = new Set(component);
    const edges = pairs.filter((pair) =>
      componentSet.has(pair.testAId) && componentSet.has(pair.testBId),
    );
    if (edges.length === 0) {
      continue;
    }

    const members = component
      .map((id) => membersById.get(id)!)
      .sort(compareMembers);
    clusters.push({
      members,
      edges,
      maxCoFailRate: Math.max(...edges.map((edge) => edge.coFailRate)),
      avgCoFailRate: edges.reduce((sum, edge) => sum + edge.coFailRate, 0) / edges.length,
      totalCoFailRuns: edges.reduce((sum, edge) => sum + edge.coFailRuns, 0),
    });
  }

  clusters.sort((a, b) =>
    b.members.length - a.members.length
    || b.maxCoFailRate - a.maxCoFailRate
    || b.totalCoFailRuns - a.totalCoFailRuns
    || a.members[0].suite.localeCompare(b.members[0].suite),
  );

  return clusters.map((cluster, index) => ({
    id: `cluster-${index + 1}`,
    ...cluster,
  }));
}
