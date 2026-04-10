import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface IssueBodyOpts {
  suite: string;
  testName: string;
  flakyRate: number;
  totalRuns: number;
  reason: string;
}

export function formatIssueBody(opts: IssueBodyOpts): string {
  return [
    "## Quarantined Test",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Suite | ${opts.suite} |`,
    `| Test | ${opts.testName} |`,
    `| Flaky rate | ${opts.flakyRate}% |`,
    `| Total runs | ${opts.totalRuns} |`,
    `| Quarantine reason | ${opts.reason} |`,
    "",
    "This test was automatically quarantined by [flaker](https://github.com/mizchi/flaker) because its flaky rate exceeded the configured threshold.",
    "",
    "### To fix",
    "",
    `1. Investigate the root cause using \`flaker analyze reason "${opts.suite}:${opts.testName}"\``,
    "2. Fix the test",
    `3. Remove from quarantine: \`flaker policy quarantine --remove "${opts.suite}:${opts.testName}"\``,
  ].join("\n");
}

export function isGhAvailable(): boolean {
  try {
    execSync("gh --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export interface CreateIssueOpts {
  title: string;
  body: string;
  labels?: string[];
  repo?: string;
}

export function createGhIssue(opts: CreateIssueOpts): string | null {
  const tmpFile = join(tmpdir(), `flaker-issue-${Date.now()}.md`);
  try {
    writeFileSync(tmpFile, opts.body, "utf-8");
    const args = [
      "gh", "issue", "create",
      "--title", JSON.stringify(opts.title),
      "--body-file", tmpFile,
    ];
    if (opts.labels && opts.labels.length > 0) {
      args.push("--label", opts.labels.join(","));
    }
    if (opts.repo) {
      args.push("--repo", opts.repo);
    }
    const output = execSync(args.join(" "), { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    return output.trim();
  } catch (e) {
    console.error(`Warning: failed to create GitHub issue: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}
