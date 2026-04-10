import type { MetricStore } from "../../storage/types.js";

export interface BisectResult {
  lastGoodCommit: string;
  firstBadCommit: string;
  lastGoodDate: Date;
  firstBadDate: Date;
}

export async function runBisect(opts: { store: MetricStore; suite: string; testName: string }): Promise<BisectResult | null> {
  const rows = await opts.store.raw<{ commit_sha: string; created_at: string; has_failure: boolean }>(`
    SELECT commit_sha, MIN(created_at)::VARCHAR AS created_at,
      (COUNT(*) FILTER (WHERE status = 'failed') > 0)::BOOLEAN AS has_failure
    FROM test_results WHERE suite = ? AND test_name = ?
    GROUP BY commit_sha ORDER BY MIN(created_at) ASC
  `, [opts.suite, opts.testName]);

  if (rows.length === 0) return null;

  let lastGoodIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].has_failure) { lastGoodIdx = i; }
    else if (lastGoodIdx >= 0) {
      return {
        lastGoodCommit: rows[lastGoodIdx].commit_sha,
        firstBadCommit: rows[i].commit_sha,
        lastGoodDate: new Date(rows[lastGoodIdx].created_at),
        firstBadDate: new Date(rows[i].created_at),
      };
    }
  }
  return null;
}
