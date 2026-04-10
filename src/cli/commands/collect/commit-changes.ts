import type { MetricStore } from "../../storage/types.js";
import { resolveCommitChanges } from "../../core/git.js";

interface CollectCommitChangesResult {
  commitSha: string;
  filesCollected: number;
}

export async function collectCommitChanges(
  store: MetricStore,
  cwd: string,
  commitSha: string,
): Promise<CollectCommitChangesResult | null> {
  if (await store.hasCommitChanges(commitSha)) {
    return null;
  }
  const changes = resolveCommitChanges(cwd, commitSha);
  if (!changes || changes.length === 0) {
    return null;
  }
  await store.insertCommitChanges(commitSha, changes);
  return { commitSha, filesCollected: changes.length };
}
