import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { MetricStore } from "../../storage/types.js";
import type { RepoProbe } from "./planner.js";

export async function probeRepo(input: {
  cwd: string;
  store: MetricStore;
}): Promise<RepoProbe> {
  const rows = await input.store.raw<{ has_local: number }>(
    `SELECT CASE WHEN EXISTS (SELECT 1 FROM workflow_runs WHERE source = 'local') THEN 1 ELSE 0 END AS has_local`,
  );
  const hasLocalHistory = rows[0]?.has_local === 1;
  return {
    hasGitRemote: existsSync(resolve(input.cwd, ".git")),
    hasGithubToken: Boolean(process.env.GITHUB_TOKEN),
    hasLocalHistory,
  };
}
