# `flaker retry` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `flaker retry` command that fetches failed tests from a CI workflow run via `gh`, re-runs them locally, and reports which failures reproduced.

**Architecture:** A single `retry.ts` module handles fetching failures from `gh`, parsing with the configured adapter, running locally via the configured runner, and comparing results. Reuses existing `gh.ts`, adapter, and runner infrastructure.

**Tech Stack:** TypeScript, vitest, `gh` CLI, `node:child_process`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/cli/commands/retry.ts` | Create | Fetch CI failures, run locally, compare, format output |
| `tests/cli/retry.test.ts` | Create | Unit tests for comparison and formatting logic |
| `src/cli/main.ts` | Modify | Wire `retry` command |
| `README.md` | Modify | Add retry documentation |

---

### Task 1: Retry comparison logic and formatting

**Files:**
- Create: `src/cli/commands/retry.ts`
- Create: `tests/cli/retry.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/cli/retry.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  compareRetryResults,
  formatRetryReport,
  type RetryTestResult,
} from "../../src/cli/commands/retry.js";

describe("compareRetryResults", () => {
  it("marks reproduced when local also fails", () => {
    const ciFailures = [
      { suite: "tests/api.test.ts", testName: "handles timeout" },
    ];
    const localResults = [
      { suite: "tests/api.test.ts", testName: "handles timeout", status: "failed" as const, durationMs: 100 },
    ];
    const result = compareRetryResults(ciFailures, localResults);
    expect(result).toHaveLength(1);
    expect(result[0].reproduced).toBe(true);
  });

  it("marks not reproduced when local passes", () => {
    const ciFailures = [
      { suite: "tests/api.test.ts", testName: "handles timeout" },
    ];
    const localResults = [
      { suite: "tests/api.test.ts", testName: "handles timeout", status: "passed" as const, durationMs: 100 },
    ];
    const result = compareRetryResults(ciFailures, localResults);
    expect(result).toHaveLength(1);
    expect(result[0].reproduced).toBe(false);
  });

  it("marks not reproduced when test not found in local results", () => {
    const ciFailures = [
      { suite: "tests/api.test.ts", testName: "handles timeout" },
    ];
    const localResults: Array<{ suite: string; testName: string; status: "passed" | "failed"; durationMs: number }> = [];
    const result = compareRetryResults(ciFailures, localResults);
    expect(result).toHaveLength(1);
    expect(result[0].reproduced).toBe(false);
  });

  it("handles multiple failures", () => {
    const ciFailures = [
      { suite: "tests/api.test.ts", testName: "handles timeout" },
      { suite: "tests/db.test.ts", testName: "concurrent write" },
      { suite: "tests/auth.test.ts", testName: "token refresh" },
    ];
    const localResults = [
      { suite: "tests/api.test.ts", testName: "handles timeout", status: "failed" as const, durationMs: 100 },
      { suite: "tests/db.test.ts", testName: "concurrent write", status: "passed" as const, durationMs: 200 },
      { suite: "tests/auth.test.ts", testName: "token refresh", status: "failed" as const, durationMs: 150 },
    ];
    const result = compareRetryResults(ciFailures, localResults);
    expect(result.filter((r) => r.reproduced)).toHaveLength(2);
    expect(result.filter((r) => !r.reproduced)).toHaveLength(1);
  });
});

describe("formatRetryReport", () => {
  it("formats report with reproduced and not-reproduced tests", () => {
    const results: RetryTestResult[] = [
      { suite: "tests/api.test.ts", testName: "handles timeout", reproduced: true },
      { suite: "tests/db.test.ts", testName: "concurrent write", reproduced: false },
    ];
    const output = formatRetryReport(12345678, results);
    expect(output).toContain("12345678");
    expect(output).toContain("handles timeout");
    expect(output).toContain("reproduced");
    expect(output).toContain("not reproduced");
    expect(output).toContain("Reproduced:     1/2");
  });

  it("formats report when all reproduced", () => {
    const results: RetryTestResult[] = [
      { suite: "tests/api.test.ts", testName: "test1", reproduced: true },
    ];
    const output = formatRetryReport(999, results);
    expect(output).toContain("Reproduced:     1/1");
    expect(output).not.toContain("Not reproduced:");
  });

  it("formats report when none reproduced", () => {
    const results: RetryTestResult[] = [
      { suite: "tests/api.test.ts", testName: "test1", reproduced: false },
    ];
    const output = formatRetryReport(999, results);
    expect(output).toContain("Not reproduced: 1/1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/cli/retry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement retry.ts**

Create `src/cli/commands/retry.ts`:

```typescript
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isGhAvailable } from "../gh.js";
import type { TestResultAdapter, TestCaseResult } from "../adapters/types.js";
import type { RunnerAdapter, TestId } from "../runners/types.js";

export interface RetryTestResult {
  suite: string;
  testName: string;
  reproduced: boolean;
}

export interface RetryOpts {
  runId?: number;
  repo: string;
  adapter: TestResultAdapter;
  runner: RunnerAdapter;
  artifactName: string;
  cwd?: string;
}

interface CiFailure {
  suite: string;
  testName: string;
}

interface LocalResult {
  suite: string;
  testName: string;
  status: "passed" | "failed";
  durationMs: number;
}

function ghExec(args: string): string {
  return execSync(`gh ${args}`, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function compareRetryResults(
  ciFailures: CiFailure[],
  localResults: LocalResult[],
): RetryTestResult[] {
  return ciFailures.map((failure) => {
    const local = localResults.find(
      (r) => r.suite === failure.suite && r.testName === failure.testName,
    );
    return {
      suite: failure.suite,
      testName: failure.testName,
      reproduced: local?.status === "failed",
    };
  });
}

export function formatRetryReport(runId: number, results: RetryTestResult[]): string {
  const reproduced = results.filter((r) => r.reproduced);
  const notReproduced = results.filter((r) => !r.reproduced);

  const lines = [
    `# Retry: run ${runId} (${results.length} failed test${results.length !== 1 ? "s" : ""})`,
    "",
    "  Results:",
  ];

  for (const r of results) {
    const label = r.reproduced ? "reproduced" : "not reproduced";
    const status = r.reproduced ? "FAIL" : "PASS";
    lines.push(`    ${status}  ${r.suite} > ${r.testName}  (${label})`);
  }

  lines.push("");
  lines.push("  Summary:");
  if (reproduced.length > 0) {
    lines.push(`    Reproduced:     ${reproduced.length}/${results.length}`);
  }
  if (notReproduced.length > 0) {
    lines.push(`    Not reproduced: ${notReproduced.length}/${results.length} (likely CI-specific or flaky)`);
  }

  return lines.join("\n");
}

function getLatestFailedRunId(repo: string): number {
  const output = ghExec(
    `run list --repo=${repo} --status=failure --limit=1 --json databaseId`,
  );
  const runs = JSON.parse(output) as Array<{ databaseId: number }>;
  if (runs.length === 0) {
    throw new Error("No failed runs found in recent workflow runs.");
  }
  return runs[0].databaseId;
}

function downloadRunArtifact(repo: string, runId: number, artifactName: string): string {
  const dir = join(tmpdir(), `flaker-retry-${runId}`);
  try {
    ghExec(`run download ${runId} --repo=${repo} --name=${artifactName} --dir=${dir}`);
  } catch {
    throw new Error(
      `Failed to download artifact "${artifactName}" from run ${runId}. ` +
      "Ensure CI uploads test results as an artifact.",
    );
  }
  return dir;
}

function extractFailedTests(dir: string, adapter: TestResultAdapter): CiFailure[] {
  if (!existsSync(dir)) {
    throw new Error(`Artifact directory not found: ${dir}`);
  }
  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".json") || f.endsWith(".xml"),
  );
  const failures: CiFailure[] = [];

  for (const file of files) {
    const content = readFileSync(join(dir, file), "utf-8");
    try {
      const results = adapter.parse(content);
      for (const r of results) {
        if (r.status === "failed") {
          failures.push({ suite: r.suite, testName: r.testName });
        }
      }
    } catch {
      // Skip unparseable files
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return failures.filter((f) => {
    const key = `${f.suite}::${f.testName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function runRetry(opts: RetryOpts): Promise<{
  runId: number;
  results: RetryTestResult[];
}> {
  if (!isGhAvailable()) {
    throw new Error("gh CLI is required. Install from https://cli.github.com/");
  }

  const runId = opts.runId ?? getLatestFailedRunId(opts.repo);
  console.log(`  Fetching failed tests from run ${runId}...`);

  const artifactDir = downloadRunArtifact(opts.repo, runId, opts.artifactName);
  const ciFailures = extractFailedTests(artifactDir, opts.adapter);

  if (ciFailures.length === 0) {
    console.log(`  No failed tests found in run ${runId}.`);
    return { runId, results: [] };
  }

  console.log(`  Found ${ciFailures.length} failed test${ciFailures.length !== 1 ? "s" : ""}:`);
  for (const f of ciFailures) {
    console.log(`    ${f.suite} > ${f.testName}`);
  }
  console.log("");
  console.log("  Running locally...");

  const testIds: TestId[] = ciFailures.map((f) => ({
    suite: f.suite,
    testName: f.testName,
  }));

  const execResult = await opts.runner.execute(testIds, { cwd: opts.cwd });

  const localResults: LocalResult[] = execResult.results.map((r) => ({
    suite: r.suite,
    testName: r.testName,
    status: r.status === "failed" ? "failed" as const : "passed" as const,
    durationMs: r.durationMs,
  }));

  const compared = compareRetryResults(ciFailures, localResults);
  return { runId, results: compared };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/cli/retry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/retry.ts tests/cli/retry.test.ts
git commit -m "feat: add retry command with comparison logic and formatting"
```

---

### Task 2: Wire retry into CLI

**Files:**
- Modify: `src/cli/main.ts`

- [ ] **Step 1: Add imports**

Add near the top of main.ts:

```typescript
import { runRetry, formatRetryReport } from "./commands/retry.js";
import { createTestResultAdapter } from "./adapters/index.js";
```

Check if `createTestResultAdapter` is already imported — it may be. If so, skip that import.

- [ ] **Step 2: Add retry command**

Find the confirm command section in main.ts. Add the retry command after it:

```typescript
// --- retry ---
program
  .command("retry")
  .description("Re-run failed tests from a CI workflow run locally")
  .option("--run <id>", "Workflow run ID (default: most recent failure)")
  .option("--repo <owner/name>", "Repository (default: from flaker.toml)")
  .action(
    async (opts: { run?: string; repo?: string }) => {
      const config = loadConfig(process.cwd());
      const repo = opts.repo ?? `${config.repo.owner}/${config.repo.name}`;
      const runId = opts.run ? parseInt(opts.run, 10) : undefined;
      const adapter = createTestResultAdapter(config.adapter.type, config.adapter.command);
      const runner = createRunner(config.runner);
      const artifactName = config.adapter.artifact_name ?? `${config.adapter.type}-report`;

      console.log("# Retry: fetching CI failures and running locally");
      console.log("");

      try {
        const { runId: resolvedRunId, results } = await runRetry({
          runId,
          repo,
          adapter,
          runner,
          artifactName,
          cwd: process.cwd(),
        });

        if (results.length === 0) {
          return;
        }

        console.log("");
        console.log(formatRetryReport(resolvedRunId, results));

        const reproduced = results.filter((r) => r.reproduced);
        if (reproduced.length > 0) {
          process.exit(1);
        }
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    },
  );
```

- [ ] **Step 3: Add help examples**

Find the help examples section. Add:

```typescript
  appendExamplesToCommand(program.commands.find((command) => command.name() === "retry"), [
    "flaker retry",
    "flaker retry --run 12345678",
  ]);
```

- [ ] **Step 4: Run full test suite**

Run: `pnpm exec vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/cli/main.ts
git commit -m "feat: wire retry command into CLI"
```

---

### Task 3: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add retry section**

In `README.md`, find the "### Confirm suspected failures" section. Add a new section AFTER it and BEFORE "### Policy and ownership":

```markdown
### Retry CI failures locally

```bash
# Re-run failed tests from most recent CI failure
flaker retry

# From a specific workflow run
flaker retry --run 12345678
```

Fetches the test result artifact from the failed CI run, identifies failed tests, and re-runs them locally. Reports which failures reproduce (real regressions) vs which don't (CI-specific or flaky).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add retry command to README"
```
