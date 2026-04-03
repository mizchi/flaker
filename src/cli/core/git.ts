import { execSync } from "node:child_process";
import type { CommitChange } from "../storage/types.js";

const CHANGE_TYPE_MAP: Record<string, string> = {
  A: "added",
  M: "modified",
  D: "deleted",
  C: "copied",
};

export function parseGitDiffTree(output: string): CommitChange[] {
  const results: CommitChange[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const status = parts[0];
    if (status.startsWith("R")) {
      results.push({
        filePath: parts[2] ?? parts[1],
        changeType: "renamed",
        additions: 0,
        deletions: 0,
      });
    } else {
      results.push({
        filePath: parts[1],
        changeType: CHANGE_TYPE_MAP[status] ?? status.toLowerCase(),
        additions: 0,
        deletions: 0,
      });
    }
  }
  return results;
}

export function resolveCommitChanges(cwd: string, commitSha: string): CommitChange[] | null {
  try {
    const output = execSync(
      `git diff-tree --no-commit-id --name-status -r ${commitSha}`,
      { cwd, stdio: ["ignore", "pipe", "ignore"] },
    ).toString("utf8");
    return parseGitDiffTree(output);
  } catch {
    return null;
  }
}

export function resolveCurrentCommitSha(cwd: string): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString("utf8")
      .trim();
  } catch {
    return null;
  }
}
