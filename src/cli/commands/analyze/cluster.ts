import { buildFailureClusters, type FailureCluster, getDefaultClusterQuery } from "../../failure-clusters.js";
import type { MetricStore } from "../../storage/types.js";

export interface FailureClusterOpts {
  store: MetricStore;
  windowDays?: number;
  minCoFailures?: number;
  minCoRate?: number;
  top?: number;
}

export async function runFailureClusters(
  opts: FailureClusterOpts,
): Promise<FailureCluster[]> {
  const defaults = getDefaultClusterQuery();
  const pairs = await opts.store.queryTestCoFailures({
    windowDays: opts.windowDays ?? defaults.windowDays,
    minCoFailures: opts.minCoFailures ?? defaults.minCoFailures,
    minCoRate: opts.minCoRate ?? defaults.minCoRate,
  });
  const clusters = buildFailureClusters(pairs);
  return opts.top != null ? clusters.slice(0, opts.top) : clusters;
}

export function formatFailureClusters(
  clusters: FailureCluster[],
): string {
  if (clusters.length === 0) {
    return "No failure clusters found.";
  }

  const lines = ["# Failure Clusters", ""];

  for (const cluster of clusters) {
    lines.push(
      `## ${cluster.id}  (${cluster.members.length} tests, ${cluster.edges.length} links, max ${(cluster.maxCoFailRate * 100).toFixed(1)}%)`,
    );
    lines.push(
      `avg ${(cluster.avgCoFailRate * 100).toFixed(1)}%, co-fail runs ${cluster.totalCoFailRuns}`,
    );
    for (const member of cluster.members) {
      lines.push(`- ${member.suite} > ${member.testName} (${member.failRuns} fail runs)`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
