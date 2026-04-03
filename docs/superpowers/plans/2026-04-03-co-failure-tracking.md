# Co-failure Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `commit_changes` table and co-failure query to enable ML-based test selection (Stage 1)

**Architecture:** Add a `commit_changes` table to DuckDB that records which files changed per commit. Collect data via `git diff-tree` during `collect` and `collect-local`. Expose a co-failure query that joins `commit_changes` with `test_results`. Integrate co-failure rate into `sample_weighted` and `sample_hybrid` via a new `co_failure_boost` field on `TestMeta`.

**Tech Stack:** TypeScript (CLI/storage), MoonBit (sampling/contracts), DuckDB, vitest

---

### Task 1: Add `commit_changes` table to schema

**Files:**
- Modify: `src/cli/storage/schema.ts:1-95`
- Modify: `src/cli/storage/types.ts`
- Modify: `src/cli/storage/duckdb.ts`
- Test: `tests/storage/commit-changes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/storage/commit-changes.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";

describe("commit_changes storage", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("inserts and queries commit changes", async () => {
    await store.insertCommitChanges("abc123", [
      { filePath: "src/foo.ts", changeType: "modified", additions: 10, deletions: 5 },
      { filePath: "src/bar.ts", changeType: "added", additions: 20, deletions: 0 },
    ]);

    const rows = await store.raw<{ file_path: string; change_type: string }>(
      "SELECT file_path, change_type FROM commit_changes WHERE commit_sha = ?",
      ["abc123"],
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.file_path).sort()).toEqual(["src/bar.ts", "src/foo.ts"]);
  });

  it("skips duplicates on re-insert", async () => {
    const changes = [
      { filePath: "src/foo.ts", changeType: "modified", additions: 10, deletions: 5 },
    ];
    await store.insertCommitChanges("abc123", changes);
    await store.insertCommitChanges("abc123", changes);

    const rows = await store.raw<{ cnt: number }>(
      "SELECT COUNT(*)::INTEGER AS cnt FROM commit_changes WHERE commit_sha = ?",
      ["abc123"],
    );
    expect(rows[0].cnt).toBe(1);
  });

  it("hasCommitChanges returns correct value", async () => {
    expect(await store.hasCommitChanges("abc123")).toBe(false);
    await store.insertCommitChanges("abc123", [
      { filePath: "src/foo.ts", changeType: "modified", additions: 1, deletions: 1 },
    ]);
    expect(await store.hasCommitChanges("abc123")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/storage/commit-changes.test.ts`
Expected: FAIL — `insertCommitChanges` and `hasCommitChanges` do not exist

- [ ] **Step 3: Add types**

In `src/cli/storage/types.ts`, add the interface and extend `MetricStore`:

```typescript
export interface CommitChange {
  filePath: string;
  changeType: string;
  additions: number;
  deletions: number;
}
```

Add to `MetricStore` interface:

```typescript
  insertCommitChanges(commitSha: string, changes: CommitChange[]): Promise<void>;
  hasCommitChanges(commitSha: string): Promise<boolean>;
```

- [ ] **Step 4: Add DDL to schema.ts**

Append to `SCHEMA_DDL` in `src/cli/storage/schema.ts`, before the closing backtick:

```sql
CREATE TABLE IF NOT EXISTS commit_changes (
  commit_sha  VARCHAR NOT NULL,
  file_path   VARCHAR NOT NULL,
  change_type VARCHAR,
  additions   INTEGER DEFAULT 0,
  deletions   INTEGER DEFAULT 0,
  PRIMARY KEY (commit_sha, file_path)
);
```

- [ ] **Step 5: Implement in duckdb.ts**

Add methods to `DuckDBStore` class in `src/cli/storage/duckdb.ts`:

```typescript
  async insertCommitChanges(commitSha: string, changes: CommitChange[]): Promise<void> {
    for (const change of changes) {
      await this.run(
        `INSERT INTO commit_changes (commit_sha, file_path, change_type, additions, deletions)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (commit_sha, file_path) DO NOTHING`,
        [commitSha, change.filePath, change.changeType, change.additions, change.deletions],
      );
    }
  }

  async hasCommitChanges(commitSha: string): Promise<boolean> {
    const rows = await this.all(
      `SELECT 1 FROM commit_changes WHERE commit_sha = ? LIMIT 1`,
      [commitSha],
    );
    return rows.length > 0;
  }
```

Add `CommitChange` to the import from `./types.js`.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run tests/storage/commit-changes.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add tests/storage/commit-changes.test.ts src/cli/storage/schema.ts src/cli/storage/types.ts src/cli/storage/duckdb.ts
git commit -m "feat: add commit_changes table for co-failure tracking"
```

---

### Task 2: Add `git diff-tree` utility

**Files:**
- Modify: `src/cli/core/git.ts`
- Test: `tests/core/git-diff-tree.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/core/git-diff-tree.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseGitDiffTree, resolveCommitChanges } from "../../src/cli/core/git.js";

describe("parseGitDiffTree", () => {
  it("parses name-status output", () => {
    const output = "M\tsrc/foo.ts\nA\tsrc/bar.ts\nD\tsrc/old.ts\n";
    const result = parseGitDiffTree(output);
    expect(result).toEqual([
      { filePath: "src/foo.ts", changeType: "modified", additions: 0, deletions: 0 },
      { filePath: "src/bar.ts", changeType: "added", additions: 0, deletions: 0 },
      { filePath: "src/old.ts", changeType: "deleted", additions: 0, deletions: 0 },
    ]);
  });

  it("handles rename status", () => {
    const output = "R100\told/path.ts\tnew/path.ts\n";
    const result = parseGitDiffTree(output);
    expect(result).toEqual([
      { filePath: "new/path.ts", changeType: "renamed", additions: 0, deletions: 0 },
    ]);
  });

  it("handles empty output", () => {
    expect(parseGitDiffTree("")).toEqual([]);
    expect(parseGitDiffTree("\n")).toEqual([]);
  });
});

describe("resolveCommitChanges", () => {
  it("returns changes for HEAD commit", () => {
    // Uses the actual git repo — flaker itself
    const changes = resolveCommitChanges(process.cwd(), "HEAD");
    expect(changes).not.toBeNull();
    if (changes) {
      expect(changes.length).toBeGreaterThan(0);
      expect(changes[0]).toHaveProperty("filePath");
      expect(changes[0]).toHaveProperty("changeType");
    }
  });

  it("returns null for invalid sha", () => {
    const changes = resolveCommitChanges(process.cwd(), "0000000000000000000000000000000000000000");
    expect(changes).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/core/git-diff-tree.test.ts`
Expected: FAIL — `parseGitDiffTree` and `resolveCommitChanges` do not exist

- [ ] **Step 3: Implement**

In `src/cli/core/git.ts`, add:

```typescript
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
      // Rename: R<score>\told\tnew
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/core/git-diff-tree.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/core/git.ts tests/core/git-diff-tree.test.ts
git commit -m "feat: add git diff-tree parser for commit change tracking"
```

---

### Task 3: Collect commit changes during `collect` and `collect-local`

**Files:**
- Modify: `src/cli/commands/collect.ts`
- Modify: `src/cli/commands/collect-local.ts`
- Test: `tests/commands/collect.test.ts` (extend existing)

- [ ] **Step 1: Write the failing test**

Add a test to `tests/commands/collect.test.ts` (or a new file `tests/commands/collect-commit-changes.test.ts` if the existing file is complex):

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { collectCommitChanges } from "../../src/cli/commands/collect-commit-changes.js";

describe("collectCommitChanges", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("stores commit changes for a known commit", async () => {
    // Use HEAD of the flaker repo itself
    const result = await collectCommitChanges(store, process.cwd(), "HEAD");
    expect(result).not.toBeNull();
    if (result) {
      expect(result.filesCollected).toBeGreaterThan(0);
      const hasChanges = await store.hasCommitChanges("HEAD");
      // hasCommitChanges checks exact sha, but we stored resolved HEAD
      // Verify via raw query
      const rows = await store.raw<{ cnt: number }>(
        "SELECT COUNT(*)::INTEGER AS cnt FROM commit_changes",
      );
      expect(rows[0].cnt).toBeGreaterThan(0);
    }
  });

  it("skips if commit changes already collected", async () => {
    const sha = "abc123";
    await store.insertCommitChanges(sha, [
      { filePath: "src/foo.ts", changeType: "modified", additions: 0, deletions: 0 },
    ]);
    const result = await collectCommitChanges(store, process.cwd(), sha);
    expect(result).toBeNull(); // Already collected, skipped
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/commands/collect-commit-changes.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement collectCommitChanges**

Create `src/cli/commands/collect-commit-changes.ts`:

```typescript
import type { MetricStore } from "../storage/types.js";
import { resolveCommitChanges } from "../core/git.js";

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/commands/collect-commit-changes.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into collect.ts**

In `src/cli/commands/collect.ts`, after `insertWorkflowRun(workflowRun)` and test result insertion, add:

```typescript
import { collectCommitChanges } from "./collect-commit-changes.js";

// Inside the workflow run loop, after insertTestResults:
await collectCommitChanges(store, cwd, run.head_sha);
```

- [ ] **Step 6: Wire into collect-local.ts**

In `src/cli/commands/collect-local.ts`, after test result insertion, add:

```typescript
import { collectCommitChanges } from "./collect-commit-changes.js";
import { resolveCurrentCommitSha } from "../core/git.js";

// After insertTestResults, resolve real commit sha and collect:
const realCommitSha = resolveCurrentCommitSha(cwd);
if (realCommitSha) {
  await collectCommitChanges(store, cwd, realCommitSha);
}
```

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/collect-commit-changes.ts src/cli/commands/collect.ts src/cli/commands/collect-local.ts tests/commands/collect-commit-changes.test.ts
git commit -m "feat: collect commit changes during collect and collect-local"
```

---

### Task 4: Add co-failure query

**Files:**
- Modify: `src/cli/storage/schema.ts`
- Modify: `src/cli/storage/types.ts`
- Modify: `src/cli/storage/duckdb.ts`
- Test: `tests/storage/co-failure.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/storage/co-failure.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";

describe("co-failure query", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();

    // Create 3 workflow runs with different commits
    for (let i = 1; i <= 3; i++) {
      await store.insertWorkflowRun({
        id: i,
        repo: "test/repo",
        branch: "main",
        commitSha: `sha${i}`,
        event: "push",
        status: "completed",
        createdAt: new Date(Date.now() - (4 - i) * 86400000),
        durationMs: 60000,
      });
    }

    // sha1: changed src/auth.ts -> test-login failed
    await store.insertCommitChanges("sha1", [
      { filePath: "src/auth.ts", changeType: "modified", additions: 5, deletions: 2 },
    ]);
    await store.insertTestResults([
      {
        workflowRunId: 1, suite: "tests/login.spec.ts", testName: "login works",
        status: "failed", durationMs: 100, retryCount: 0, errorMessage: "err",
        commitSha: "sha1", variant: null, createdAt: new Date(Date.now() - 3 * 86400000),
      },
      {
        workflowRunId: 1, suite: "tests/signup.spec.ts", testName: "signup works",
        status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
        commitSha: "sha1", variant: null, createdAt: new Date(Date.now() - 3 * 86400000),
      },
    ]);

    // sha2: changed src/auth.ts again -> test-login failed again
    await store.insertCommitChanges("sha2", [
      { filePath: "src/auth.ts", changeType: "modified", additions: 3, deletions: 1 },
    ]);
    await store.insertTestResults([
      {
        workflowRunId: 2, suite: "tests/login.spec.ts", testName: "login works",
        status: "failed", durationMs: 100, retryCount: 0, errorMessage: "err",
        commitSha: "sha2", variant: null, createdAt: new Date(Date.now() - 2 * 86400000),
      },
      {
        workflowRunId: 2, suite: "tests/signup.spec.ts", testName: "signup works",
        status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
        commitSha: "sha2", variant: null, createdAt: new Date(Date.now() - 2 * 86400000),
      },
    ]);

    // sha3: changed src/ui.ts -> everything passed
    await store.insertCommitChanges("sha3", [
      { filePath: "src/ui.ts", changeType: "modified", additions: 10, deletions: 0 },
    ]);
    await store.insertTestResults([
      {
        workflowRunId: 3, suite: "tests/login.spec.ts", testName: "login works",
        status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
        commitSha: "sha3", variant: null, createdAt: new Date(Date.now() - 86400000),
      },
      {
        workflowRunId: 3, suite: "tests/signup.spec.ts", testName: "signup works",
        status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
        commitSha: "sha3", variant: null, createdAt: new Date(Date.now() - 86400000),
      },
    ]);
  });

  afterEach(async () => {
    await store.close();
  });

  it("computes co-failure rates", async () => {
    const results = await store.queryCoFailures({ windowDays: 90, minCoRuns: 2 });
    // src/auth.ts + login: 2 co-runs, 2 failures = 100%
    const authLogin = results.find(
      (r) => r.filePath === "src/auth.ts" && r.suite === "tests/login.spec.ts",
    );
    expect(authLogin).toBeDefined();
    expect(authLogin!.coFailureRate).toBe(100);
    expect(authLogin!.coRuns).toBe(2);
    expect(authLogin!.coFailures).toBe(2);

    // src/auth.ts + signup: 2 co-runs, 0 failures = 0% (should not appear)
    const authSignup = results.find(
      (r) => r.filePath === "src/auth.ts" && r.suite === "tests/signup.spec.ts",
    );
    expect(authSignup).toBeUndefined();
  });

  it("respects minCoRuns filter", async () => {
    const results = await store.queryCoFailures({ windowDays: 90, minCoRuns: 3 });
    // src/auth.ts only has 2 co-runs with login, so nothing qualifies at minCoRuns=3
    expect(results).toHaveLength(0);
  });

  it("getCoFailureBoosts returns boost for changed files", async () => {
    const boosts = await store.getCoFailureBoosts(
      ["src/auth.ts"],
      { windowDays: 90, minCoRuns: 2 },
    );
    // login test should have high boost
    expect(boosts.size).toBeGreaterThan(0);
    const loginBoost = [...boosts.entries()].find(([, v]) => v > 0);
    expect(loginBoost).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/storage/co-failure.test.ts`
Expected: FAIL — `queryCoFailures` and `getCoFailureBoosts` do not exist

- [ ] **Step 3: Add types**

In `src/cli/storage/types.ts`, add:

```typescript
export interface CoFailureResult {
  filePath: string;
  testId: string;
  suite: string;
  testName: string;
  coRuns: number;
  coFailures: number;
  coFailureRate: number;
}

export interface CoFailureQueryOpts {
  windowDays?: number;
  minCoRuns?: number;
}
```

Add to `MetricStore` interface:

```typescript
  queryCoFailures(opts: CoFailureQueryOpts): Promise<CoFailureResult[]>;
  getCoFailureBoosts(changedFiles: string[], opts?: CoFailureQueryOpts): Promise<Map<string, number>>;
```

- [ ] **Step 4: Add co-failure query constant to schema.ts**

In `src/cli/storage/schema.ts`, add after `FLAKY_QUERY`:

```typescript
export const CO_FAILURE_QUERY = `
SELECT
  cc.file_path,
  COALESCE(tr.test_id, '') AS test_id,
  tr.suite,
  tr.test_name,
  COUNT(*)::INTEGER AS co_runs,
  COUNT(*) FILTER (WHERE tr.status IN ('failed', 'flaky')
    OR (tr.retry_count > 0 AND tr.status = 'passed'))::INTEGER AS co_failures,
  ROUND(
    COUNT(*) FILTER (WHERE tr.status IN ('failed', 'flaky')
      OR (tr.retry_count > 0 AND tr.status = 'passed'))
    * 100.0 / COUNT(*), 2
  )::DOUBLE AS co_failure_rate
FROM commit_changes cc
JOIN test_results tr ON cc.commit_sha = tr.commit_sha
WHERE tr.created_at > CURRENT_TIMESTAMP - INTERVAL (? || ' days')
GROUP BY cc.file_path, tr.test_id, tr.suite, tr.test_name
HAVING co_runs >= ? AND co_failures > 0
ORDER BY co_failure_rate DESC
`;
```

- [ ] **Step 5: Implement in duckdb.ts**

Add methods to `DuckDBStore`:

```typescript
  async queryCoFailures(opts: CoFailureQueryOpts): Promise<CoFailureResult[]> {
    const windowDays = opts.windowDays ?? 90;
    const minCoRuns = opts.minCoRuns ?? 3;
    const rows = await this.all(CO_FAILURE_QUERY, [windowDays.toString(), minCoRuns]);
    return rows.map((r: any) => ({
      filePath: r.file_path,
      testId: r.test_id,
      suite: r.suite,
      testName: r.test_name,
      coRuns: r.co_runs,
      coFailures: r.co_failures,
      coFailureRate: r.co_failure_rate,
    }));
  }

  async getCoFailureBoosts(
    changedFiles: string[],
    opts?: CoFailureQueryOpts,
  ): Promise<Map<string, number>> {
    if (changedFiles.length === 0) {
      return new Map();
    }
    const allCoFailures = await this.queryCoFailures(opts ?? {});
    const changedSet = new Set(changedFiles);
    const boosts = new Map<string, number>();
    for (const cf of allCoFailures) {
      if (!changedSet.has(cf.filePath)) continue;
      const existing = boosts.get(cf.testId) ?? 0;
      boosts.set(cf.testId, Math.max(existing, cf.coFailureRate / 100));
    }
    return boosts;
  }
```

Add imports: `CO_FAILURE_QUERY` from schema, `CoFailureResult`, `CoFailureQueryOpts` from types.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run tests/storage/co-failure.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/cli/storage/schema.ts src/cli/storage/types.ts src/cli/storage/duckdb.ts tests/storage/co-failure.test.ts
git commit -m "feat: add co-failure query for file-test correlation tracking"
```

---

### Task 5: Add `co_failure_boost` to TestMeta and sampling

**Files:**
- Modify: `src/contracts/types.mbt` (TestMeta struct)
- Modify: `src/sampling/sampler.mbt` (sample_weighted, sample_hybrid)
- Modify: `src/cli/core/loader.ts` (TestMeta TS interface)
- Modify: `src/cli/commands/sample.ts` (pass co-failure data)
- Test: `tests/commands/sample-co-failure.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/commands/sample-co-failure.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import type { TestResult, WorkflowRun } from "../../src/cli/storage/types.js";
import { planSample } from "../../src/cli/commands/sample.js";

describe("sample with co-failure boost", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();

    // 3 commits: sha1, sha2, sha3
    for (let i = 1; i <= 3; i++) {
      await store.insertWorkflowRun({
        id: i, repo: "test/repo", branch: "main", commitSha: `sha${i}`,
        event: "push", status: "completed",
        createdAt: new Date(Date.now() - (4 - i) * 86400000), durationMs: 60000,
      });
    }

    // sha1 and sha2 both change src/auth.ts and test-login fails
    for (const [sha, runId] of [["sha1", 1], ["sha2", 2]] as const) {
      await store.insertCommitChanges(sha, [
        { filePath: "src/auth.ts", changeType: "modified", additions: 5, deletions: 2 },
      ]);
      await store.insertTestResults([
        {
          workflowRunId: runId, suite: "tests/login.spec.ts", testName: "login works",
          status: "failed", durationMs: 100, retryCount: 0, errorMessage: "err",
          commitSha: sha, variant: null, createdAt: new Date(Date.now() - (4 - runId) * 86400000),
        },
        {
          workflowRunId: runId, suite: "tests/signup.spec.ts", testName: "signup works",
          status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
          commitSha: sha, variant: null, createdAt: new Date(Date.now() - (4 - runId) * 86400000),
        },
        {
          workflowRunId: runId, suite: "tests/dashboard.spec.ts", testName: "dashboard loads",
          status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
          commitSha: sha, variant: null, createdAt: new Date(Date.now() - (4 - runId) * 86400000),
        },
      ]);
    }

    // sha3 changes src/ui.ts, everything passes
    await store.insertCommitChanges("sha3", [
      { filePath: "src/ui.ts", changeType: "modified", additions: 10, deletions: 0 },
    ]);
    await store.insertTestResults([
      {
        workflowRunId: 3, suite: "tests/login.spec.ts", testName: "login works",
        status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
        commitSha: "sha3", variant: null, createdAt: new Date(Date.now() - 86400000),
      },
      {
        workflowRunId: 3, suite: "tests/signup.spec.ts", testName: "signup works",
        status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
        commitSha: "sha3", variant: null, createdAt: new Date(Date.now() - 86400000),
      },
      {
        workflowRunId: 3, suite: "tests/dashboard.spec.ts", testName: "dashboard loads",
        status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
        commitSha: "sha3", variant: null, createdAt: new Date(Date.now() - 86400000),
      },
    ]);
  });

  afterEach(async () => {
    await store.close();
  });

  it("weighted sampling with co-failure boost prioritizes correlated tests", async () => {
    const plan = await planSample({
      store,
      count: 1,
      mode: "weighted",
      seed: 42,
      changedFiles: ["src/auth.ts"],
    });

    // With co-failure boost, the login test (100% co-failure with src/auth.ts)
    // should be strongly favored over the others
    expect(plan.sampled).toHaveLength(1);
    // The login test has both flaky_rate AND co-failure boost, highest weight
    expect(plan.sampled[0].suite).toBe("tests/login.spec.ts");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/commands/sample-co-failure.test.ts`
Expected: FAIL — co-failure boost not integrated

- [ ] **Step 3: Add `co_failure_boost` to MoonBit TestMeta**

In `src/contracts/types.mbt`, add field to `TestMeta`:

```moonbit
pub(all) struct TestMeta {
  suite : String
  test_name : String
  flaky_rate : Double
  total_runs : Int
  fail_count : Int
  last_run_at : String
  avg_duration_ms : Int
  previously_failed : Bool
  is_new : Bool
  task_id : String?
  filter : String?
  test_id : String?
  co_failure_boost : Double  // NEW: 0.0-1.0, max co-failure rate for changed files
} derive(Eq, Show, FromJson, ToJson)
```

- [ ] **Step 4: Update MoonBit sampling to use co_failure_boost**

In `src/sampling/sampler.mbt`, update `sample_weighted` weight calculation (line 58):

```moonbit
  let weights = Array::makei(n, fn(i) { 1.0 + meta[i].flaky_rate + meta[i].co_failure_boost })
```

- [ ] **Step 5: Update TS TestMeta interface**

In `src/cli/core/loader.ts`, add to `TestMeta` interface:

```typescript
  co_failure_boost: number;
```

- [ ] **Step 6: Update MoonBit sampling_meta to set default**

In `src/sampling/sampling_meta.mbt`, where TestMeta is constructed, add:

```moonbit
  co_failure_boost: 0.0,
```

- [ ] **Step 7: Wire co-failure boosts into sample.ts**

In `src/cli/commands/sample.ts`, update `planSample`:

```typescript
export async function planSample(opts: SampleOpts): Promise<SamplePlan> {
  const core = await loadCore();
  const listedTests = opts.listedTests ?? [];
  const meta = await buildSamplingMeta(opts.store, listedTests, core);
  let allTests = meta.tests;

  // Apply co-failure boosts if changedFiles are provided
  if (opts.changedFiles && opts.changedFiles.length > 0) {
    const boosts = await opts.store.getCoFailureBoosts(opts.changedFiles);
    if (boosts.size > 0) {
      allTests = allTests.map((test) => {
        const key = test.test_id ?? createStableTestId({
          suite: test.suite,
          testName: test.test_name,
          taskId: test.task_id,
          filter: test.filter,
        });
        const boost = boosts.get(key) ?? 0;
        return boost > 0 ? { ...test, co_failure_boost: boost } : test;
      });
    }
  }

  // ... rest of existing code
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run tests/commands/sample-co-failure.test.ts`
Expected: PASS

- [ ] **Step 9: Run all existing tests to verify no regressions**

Run: `pnpm vitest run`
Expected: All tests pass. The `co_failure_boost: 0.0` default means existing behavior is unchanged.

- [ ] **Step 10: Commit**

```bash
git add src/contracts/types.mbt src/sampling/sampler.mbt src/sampling/sampling_meta.mbt src/cli/core/loader.ts src/cli/commands/sample.ts tests/commands/sample-co-failure.test.ts
git commit -m "feat: integrate co-failure boost into weighted and hybrid sampling"
```

---

### Task 6: Add `SampleOpts.coFailureDays` option

**Files:**
- Modify: `src/cli/commands/sample.ts`
- Modify: `src/cli/commands/sampling-options.ts`
- Modify: `src/cli/main.ts` (CLI option)
- Test: `tests/commands/sampling-options.test.ts` (extend)

- [ ] **Step 1: Add option to SampleOpts**

In `src/cli/commands/sample.ts`, add to `SampleOpts`:

```typescript
  coFailureDays?: number;
```

Update the `getCoFailureBoosts` call in `planSample` to pass the option:

```typescript
    const boosts = await opts.store.getCoFailureBoosts(
      opts.changedFiles,
      { windowDays: opts.coFailureDays ?? 90 },
    );
```

- [ ] **Step 2: Add CLI option**

In the CLI command registration for `sample` in `src/cli/main.ts`, add:

```typescript
  .option("--co-failure-days <days>", "co-failure window in days", "90")
```

And pass `coFailureDays: parseInt(opts.coFailureDays)` to `planSample`.

- [ ] **Step 3: Run existing tests**

Run: `pnpm vitest run tests/commands/sampling-options.test.ts tests/commands/sample.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/sample.ts src/cli/main.ts
git commit -m "feat: add --co-failure-days CLI option for sampling"
```
