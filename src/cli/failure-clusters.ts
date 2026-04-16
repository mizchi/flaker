import type { TestMeta } from "./core/loader.js";
import { createMetaKey } from "./commands/dev/test-key.js";
import type { TestCoFailurePair } from "./storage/types.js";

export const CLUSTER_SAMPLING_MODES = [
  "off",
  "spread",
  "pack",
] as const;

export type ClusterSamplingMode = (typeof CLUSTER_SAMPLING_MODES)[number];

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

function samplingPriority(test: TestMeta): number {
  return 1
    + test.flaky_rate * 3
    + (test.previously_failed ? 25 : 0)
    + (test.is_new ? 10 : 0)
    + (test.co_failure_boost ?? 0) * 5;
}

function compareBySamplingPriority(a: TestMeta, b: TestMeta): number {
  return samplingPriority(b) - samplingPriority(a)
    || b.flaky_rate - a.flaky_rate
    || a.suite.localeCompare(b.suite)
    || a.test_name.localeCompare(b.test_name);
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

function rankTests(
  allTests: TestMeta[],
  sampled: TestMeta[],
): TestMeta[] {
  const sampledKeys = new Set(sampled.map(createMetaKey));
  const remaining = allTests
    .filter((test) => !sampledKeys.has(createMetaKey(test)))
    .sort(compareBySamplingPriority);

  const ranked: TestMeta[] = [];
  const seen = new Set<string>();

  for (const test of [...sampled, ...remaining]) {
    const key = createMetaKey(test);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    ranked.push(test);
  }

  return ranked;
}

function resolveClusterMembership(
  clusters: FailureCluster[],
  allTests: TestMeta[],
): Map<string, string> {
  const allowed = new Set(allTests.map(createMetaKey));
  const membership = new Map<string, string>();

  for (const cluster of clusters) {
    const presentMembers = cluster.members.filter((member) => allowed.has(member.testId));
    if (presentMembers.length < 2) {
      continue;
    }
    for (const member of presentMembers) {
      membership.set(member.testId, cluster.id);
    }
  }

  return membership;
}

function applySpreadMode(
  ranked: TestMeta[],
  membership: Map<string, string>,
  targetCount: number,
): TestMeta[] {
  const selected: TestMeta[] = [];
  const selectedKeys = new Set<string>();
  const seenClusters = new Set<string>();

  for (const test of ranked) {
    if (selected.length >= targetCount) {
      break;
    }
    const key = createMetaKey(test);
    const clusterId = membership.get(key);
    if (clusterId && seenClusters.has(clusterId)) {
      continue;
    }
    selected.push(test);
    selectedKeys.add(key);
    if (clusterId) {
      seenClusters.add(clusterId);
    }
  }

  if (selected.length >= targetCount) {
    return selected;
  }

  for (const test of ranked) {
    if (selected.length >= targetCount) {
      break;
    }
    const key = createMetaKey(test);
    if (selectedKeys.has(key)) {
      continue;
    }
    selected.push(test);
    selectedKeys.add(key);
  }

  return selected;
}

function applyPackMode(
  ranked: TestMeta[],
  membership: Map<string, string>,
  targetCount: number,
): TestMeta[] {
  const selected: TestMeta[] = [];
  const selectedKeys = new Set<string>();
  const expandedClusters = new Set<string>();

  for (const test of ranked) {
    if (selected.length >= targetCount) {
      break;
    }
    const key = createMetaKey(test);
    if (selectedKeys.has(key)) {
      continue;
    }
    selected.push(test);
    selectedKeys.add(key);

    const clusterId = membership.get(key);
    if (!clusterId || expandedClusters.has(clusterId)) {
      continue;
    }
    expandedClusters.add(clusterId);

    for (const sibling of ranked) {
      if (selected.length >= targetCount) {
        break;
      }
      const siblingKey = createMetaKey(sibling);
      if (selectedKeys.has(siblingKey) || membership.get(siblingKey) !== clusterId) {
        continue;
      }
      selected.push(sibling);
      selectedKeys.add(siblingKey);
    }
  }

  return selected;
}

export function applyClusterSamplingMode(opts: {
  allTests: TestMeta[];
  sampled: TestMeta[];
  clusters: FailureCluster[];
  count: number;
  mode: Exclude<ClusterSamplingMode, "off">;
}): TestMeta[] {
  const targetCount = Math.min(Math.max(opts.count, 0), opts.allTests.length);
  if (targetCount === 0 || opts.sampled.length === 0 || opts.clusters.length === 0) {
    return opts.sampled.slice(0, targetCount);
  }

  const membership = resolveClusterMembership(opts.clusters, opts.allTests);
  if (membership.size === 0) {
    return opts.sampled.slice(0, targetCount);
  }

  const ranked = rankTests(opts.allTests, opts.sampled);
  return opts.mode === "pack"
    ? applyPackMode(ranked, membership, targetCount)
    : applySpreadMode(ranked, membership, targetCount);
}
