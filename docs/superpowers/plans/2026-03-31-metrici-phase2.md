# metrici Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** metrici に affected 戦略（bitflow 連携）、actrun ランナー、quarantine ポリシー、bisect コマンド、flaky trend 表示を追加し、変更影響ベースのテスト選択と flaky テスト管理を完成させる。

**Architecture:** affected 戦略は bitflow CLI を子プロセスで呼び出し変更影響テストを取得。hybrid 戦略は Microsoft TIA 式に affected + previously failed + new + weighted random を組み合わせる。actrun ランナーは CLI 経由で GitHub Actions ワークフローをローカル実行。quarantine は DuckDB テーブルで管理。bisect は二分探索で flaky 開始コミットを特定。

**Tech Stack:** TypeScript, DuckDB, bitflow CLI, actrun CLI, MoonBit (hybrid sampler)

---

## File Structure

```
src/cli/
├── resolvers/
│   ├── types.ts              # DependencyResolver interface
│   ├── bitflow.ts            # bitflow CLI integration
│   └── simple.ts             # simple path-matching fallback
├── runners/
│   ├── direct.ts             # (existing)
│   └── actrun.ts             # actrun CLI integration
├── commands/
│   ├── bisect.ts             # bisect command
│   ├── quarantine.ts         # quarantine command
│   ├── flaky.ts              # (modify: add --trend flag)
│   ├── sample.ts             # (modify: add affected/hybrid strategies)
│   ├── run.ts                # (modify: add --runner actrun, --skip-quarantined)
│   └── ...existing...
├── storage/
│   ├── schema.ts             # (modify: add quarantine table)
│   ├── duckdb.ts             # (modify: add quarantine queries)
│   └── types.ts              # (modify: add QuarantinedTest, trend types)
├── config.ts                 # (existing, already has affected/quarantine config)
└── main.ts                   # (modify: add bisect, quarantine commands)

src/core/src/
├── sampler/
│   ├── sampler.mbt           # (modify: add hybrid strategy)
│   └── sampler_test.mbt      # (modify: add hybrid tests)
└── main/
    └── main.mbt              # (modify: add hybrid export)

tests/
├── resolvers/
│   ├── bitflow.test.ts
│   └── simple.test.ts
├── runners/
│   └── actrun.test.ts
├── commands/
│   ├── bisect.test.ts
│   ├── quarantine.test.ts
│   ├── flaky-trend.test.ts
│   └── sample-hybrid.test.ts
└── ...existing...
```

---

### Task 1: Dependency Resolver Interface & Simple Resolver

**Files:**
- Create: `src/cli/resolvers/types.ts`
- Create: `src/cli/resolvers/simple.ts`
- Create: `tests/resolvers/simple.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/resolvers/simple.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SimpleResolver } from "../../src/cli/resolvers/simple.js";

describe("SimpleResolver", () => {
  const resolver = new SimpleResolver();

  it("maps changed source files to matching test files", () => {
    const allTests = [
      "tests/auth/login.spec.ts",
      "tests/auth/register.spec.ts",
      "tests/home/index.spec.ts",
    ];
    const changedFiles = ["src/auth/login.ts", "src/auth/utils.ts"];
    const affected = resolver.resolve(changedFiles, allTests);
    expect(affected).toContain("tests/auth/login.spec.ts");
    expect(affected).toContain("tests/auth/register.spec.ts");
    expect(affected).not.toContain("tests/home/index.spec.ts");
  });

  it("returns empty array when no matches", () => {
    const allTests = ["tests/home/index.spec.ts"];
    const changedFiles = ["src/payments/stripe.ts"];
    const affected = resolver.resolve(changedFiles, allTests);
    expect(affected).toEqual([]);
  });

  it("matches by directory prefix", () => {
    const allTests = [
      "tests/utils/format.spec.ts",
      "tests/utils/date.spec.ts",
    ];
    const changedFiles = ["src/utils/format.ts"];
    const affected = resolver.resolve(changedFiles, allTests);
    expect(affected).toContain("tests/utils/format.spec.ts");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/resolvers/simple.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement resolver types and simple resolver**

Create `src/cli/resolvers/types.ts`:

```typescript
export interface DependencyResolver {
  resolve(changedFiles: string[], allTestFiles: string[]): string[];
}
```

Create `src/cli/resolvers/simple.ts`:

```typescript
import type { DependencyResolver } from "./types.js";

export class SimpleResolver implements DependencyResolver {
  resolve(changedFiles: string[], allTestFiles: string[]): string[] {
    // Extract directory segments from changed files
    // e.g. "src/auth/login.ts" → ["auth"]
    const changedDirs = new Set<string>();
    for (const f of changedFiles) {
      const parts = f.replace(/^src\//, "").split("/");
      // Add each directory level as a match candidate
      for (let i = 0; i < parts.length - 1; i++) {
        changedDirs.add(parts.slice(0, i + 1).join("/"));
      }
    }

    return allTestFiles.filter((test) => {
      const testPath = test.replace(/^tests\//, "");
      return Array.from(changedDirs).some((dir) => testPath.startsWith(dir));
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/resolvers/simple.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/resolvers/ tests/resolvers/
git commit -m "feat: add DependencyResolver interface and SimpleResolver"
```

---

### Task 2: Bitflow Resolver

**Files:**
- Create: `src/cli/resolvers/bitflow.ts`
- Create: `tests/resolvers/bitflow.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/resolvers/bitflow.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { BitflowResolver } from "../../src/cli/resolvers/bitflow.js";

describe("BitflowResolver", () => {
  it("calls bitflow CLI and parses output", () => {
    // Mock execSync to simulate bitflow output
    const resolver = new BitflowResolver({
      configPath: "metrici.star",
      exec: (_cmd: string) =>
        "tests/auth/login.spec.ts\ntests/auth/register.spec.ts\n",
    });

    const allTests = [
      "tests/auth/login.spec.ts",
      "tests/auth/register.spec.ts",
      "tests/home/index.spec.ts",
    ];
    const changedFiles = ["src/auth/login.ts"];
    const affected = resolver.resolve(changedFiles, allTests);

    expect(affected).toEqual([
      "tests/auth/login.spec.ts",
      "tests/auth/register.spec.ts",
    ]);
  });

  it("returns empty when bitflow returns empty", () => {
    const resolver = new BitflowResolver({
      configPath: "metrici.star",
      exec: (_cmd: string) => "",
    });

    const affected = resolver.resolve(["src/x.ts"], ["tests/x.spec.ts"]);
    expect(affected).toEqual([]);
  });

  it("filters bitflow output against known test files", () => {
    const resolver = new BitflowResolver({
      configPath: "metrici.star",
      exec: (_cmd: string) =>
        "tests/auth/login.spec.ts\ntests/unknown/ghost.spec.ts\n",
    });

    const allTests = ["tests/auth/login.spec.ts"];
    const affected = resolver.resolve(["src/auth/login.ts"], allTests);
    // ghost.spec.ts not in allTests, should be filtered out
    expect(affected).toEqual(["tests/auth/login.spec.ts"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/resolvers/bitflow.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement BitflowResolver**

Create `src/cli/resolvers/bitflow.ts`:

```typescript
import { execSync } from "node:child_process";
import type { DependencyResolver } from "./types.js";

interface BitflowResolverOpts {
  configPath: string;
  exec?: (cmd: string) => string;
}

export class BitflowResolver implements DependencyResolver {
  private configPath: string;
  private execFn: (cmd: string) => string;

  constructor(opts: BitflowResolverOpts) {
    this.configPath = opts.configPath;
    this.execFn =
      opts.exec ??
      ((cmd: string) => execSync(cmd, { encoding: "utf-8" }));
  }

  resolve(changedFiles: string[], allTestFiles: string[]): string[] {
    if (changedFiles.length === 0) return [];

    const changedArg = changedFiles.join(",");
    const cmd = `bitflow affected --config ${this.configPath} --changed ${changedArg}`;

    let output: string;
    try {
      output = this.execFn(cmd);
    } catch {
      return [];
    }

    const affectedFromBitflow = output
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    // Filter against known test files
    const testSet = new Set(allTestFiles);
    return affectedFromBitflow.filter((f) => testSet.has(f));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/resolvers/bitflow.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/resolvers/bitflow.ts tests/resolvers/bitflow.test.ts
git commit -m "feat: add BitflowResolver for dependency-based test selection"
```

---

### Task 3: Quarantine Storage

**Files:**
- Modify: `src/cli/storage/schema.ts`
- Modify: `src/cli/storage/types.ts`
- Modify: `src/cli/storage/duckdb.ts`
- Create: `tests/storage/quarantine.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/storage/quarantine.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";

describe("Quarantine storage", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("adds a test to quarantine", async () => {
    await store.addQuarantine("tests/login.spec.ts", "should redirect", "manual");
    const quarantined = await store.queryQuarantined();
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0].suite).toBe("tests/login.spec.ts");
    expect(quarantined[0].testName).toBe("should redirect");
    expect(quarantined[0].reason).toBe("manual");
  });

  it("removes a test from quarantine", async () => {
    await store.addQuarantine("tests/login.spec.ts", "should redirect", "manual");
    await store.removeQuarantine("tests/login.spec.ts", "should redirect");
    const quarantined = await store.queryQuarantined();
    expect(quarantined).toHaveLength(0);
  });

  it("checks if a test is quarantined", async () => {
    await store.addQuarantine("tests/login.spec.ts", "should redirect", "auto");
    const isQ = await store.isQuarantined("tests/login.spec.ts", "should redirect");
    expect(isQ).toBe(true);
    const isNotQ = await store.isQuarantined("tests/login.spec.ts", "other test");
    expect(isNotQ).toBe(false);
  });

  it("does not duplicate quarantine entries", async () => {
    await store.addQuarantine("tests/login.spec.ts", "should redirect", "manual");
    await store.addQuarantine("tests/login.spec.ts", "should redirect", "auto");
    const quarantined = await store.queryQuarantined();
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0].reason).toBe("auto"); // updated
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/storage/quarantine.test.ts`
Expected: FAIL — addQuarantine not a function

- [ ] **Step 3: Add quarantine types**

Add to `src/cli/storage/types.ts`:

```typescript
export interface QuarantinedTest {
  suite: string;
  testName: string;
  reason: string;
  createdAt: Date;
}
```

Add methods to `MetricStore` interface:

```typescript
  addQuarantine(suite: string, testName: string, reason: string): Promise<void>;
  removeQuarantine(suite: string, testName: string): Promise<void>;
  queryQuarantined(): Promise<QuarantinedTest[]>;
  isQuarantined(suite: string, testName: string): Promise<boolean>;
```

- [ ] **Step 4: Add quarantine DDL**

Add to `src/cli/storage/schema.ts` in `SCHEMA_DDL`:

```sql
CREATE TABLE IF NOT EXISTS quarantined_tests (
  suite       VARCHAR NOT NULL,
  test_name   VARCHAR NOT NULL,
  reason      VARCHAR NOT NULL DEFAULT 'manual',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (suite, test_name)
);
```

- [ ] **Step 5: Implement quarantine methods in DuckDBStore**

Add to `src/cli/storage/duckdb.ts`:

```typescript
  async addQuarantine(suite: string, testName: string, reason: string): Promise<void> {
    await this.run(
      `INSERT INTO quarantined_tests (suite, test_name, reason)
       VALUES (?, ?, ?)
       ON CONFLICT (suite, test_name) DO UPDATE SET reason = ?, created_at = CURRENT_TIMESTAMP`,
      [suite, testName, reason, reason]
    );
  }

  async removeQuarantine(suite: string, testName: string): Promise<void> {
    await this.run(
      `DELETE FROM quarantined_tests WHERE suite = ? AND test_name = ?`,
      [suite, testName]
    );
  }

  async queryQuarantined(): Promise<QuarantinedTest[]> {
    const rows = await this.all(
      `SELECT suite, test_name, reason, created_at FROM quarantined_tests ORDER BY created_at DESC`
    );
    return rows.map((row: any) => ({
      suite: row.suite,
      testName: row.test_name,
      reason: row.reason,
      createdAt: new Date(row.created_at),
    }));
  }

  async isQuarantined(suite: string, testName: string): Promise<boolean> {
    const rows = await this.all(
      `SELECT 1 FROM quarantined_tests WHERE suite = ? AND test_name = ?`,
      [suite, testName]
    );
    return rows.length > 0;
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run tests/storage/quarantine.test.ts`
Expected: 4 tests PASS

- [ ] **Step 7: Run all tests**

Run: `pnpm vitest run`
Expected: All existing + new tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/cli/storage/ tests/storage/quarantine.test.ts
git commit -m "feat: add quarantine table and storage methods"
```

---

### Task 4: Quarantine Command

**Files:**
- Create: `src/cli/commands/quarantine.ts`
- Create: `tests/commands/quarantine.test.ts`
- Modify: `src/cli/main.ts` (add quarantine command)

- [ ] **Step 1: Write failing test**

Create `tests/commands/quarantine.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runQuarantine } from "../../src/cli/commands/quarantine.js";

describe("quarantine command", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("adds a test to quarantine", async () => {
    await runQuarantine({ store, action: "add", suite: "tests/login.spec.ts", testName: "should redirect" });
    const q = await store.queryQuarantined();
    expect(q).toHaveLength(1);
  });

  it("removes a test from quarantine", async () => {
    await store.addQuarantine("tests/login.spec.ts", "should redirect", "manual");
    await runQuarantine({ store, action: "remove", suite: "tests/login.spec.ts", testName: "should redirect" });
    const q = await store.queryQuarantined();
    expect(q).toHaveLength(0);
  });

  it("lists quarantined tests", async () => {
    await store.addQuarantine("tests/login.spec.ts", "should redirect", "manual");
    await store.addQuarantine("tests/home.spec.ts", "should load", "auto");
    const result = await runQuarantine({ store, action: "list" });
    expect(result).toHaveLength(2);
  });

  it("auto-quarantines based on flaky threshold", async () => {
    // Seed flaky data
    await store.insertWorkflowRun({
      id: 1, repo: "test/repo", branch: "main", commitSha: "abc",
      event: "push", status: "completed", createdAt: new Date(), durationMs: 1000,
    });
    const results = [];
    for (let i = 0; i < 20; i++) {
      results.push({
        workflowRunId: 1, suite: "tests/flaky.spec.ts", testName: "unstable",
        status: i < 8 ? "failed" : "passed", durationMs: 100, retryCount: 0,
        errorMessage: null, commitSha: "abc", variant: null, createdAt: new Date(),
      });
    }
    await store.insertTestResults(results);

    await runQuarantine({
      store, action: "auto",
      flakyRateThreshold: 30.0, minRuns: 10, windowDays: 14,
    });
    const q = await store.queryQuarantined();
    expect(q).toHaveLength(1);
    expect(q[0].suite).toBe("tests/flaky.spec.ts");
    expect(q[0].reason).toBe("auto");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/commands/quarantine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement quarantine command**

Create `src/cli/commands/quarantine.ts`:

```typescript
import type { MetricStore, QuarantinedTest } from "../storage/types.js";

interface QuarantineAddOpts {
  store: MetricStore;
  action: "add";
  suite: string;
  testName: string;
}

interface QuarantineRemoveOpts {
  store: MetricStore;
  action: "remove";
  suite: string;
  testName: string;
}

interface QuarantineListOpts {
  store: MetricStore;
  action: "list";
}

interface QuarantineAutoOpts {
  store: MetricStore;
  action: "auto";
  flakyRateThreshold: number;
  minRuns: number;
  windowDays: number;
}

type QuarantineOpts =
  | QuarantineAddOpts
  | QuarantineRemoveOpts
  | QuarantineListOpts
  | QuarantineAutoOpts;

export async function runQuarantine(
  opts: QuarantineOpts
): Promise<QuarantinedTest[] | void> {
  const { store } = opts;

  switch (opts.action) {
    case "add":
      await store.addQuarantine(opts.suite, opts.testName, "manual");
      return;

    case "remove":
      await store.removeQuarantine(opts.suite, opts.testName);
      return;

    case "list":
      return store.queryQuarantined();

    case "auto": {
      const flaky = await store.queryFlakyTests({
        windowDays: opts.windowDays,
      });
      for (const f of flaky) {
        if (f.flakyRate >= opts.flakyRateThreshold && f.totalRuns >= opts.minRuns) {
          await store.addQuarantine(f.suite, f.testName, "auto");
        }
      }
      return;
    }
  }
}

export function formatQuarantineTable(tests: QuarantinedTest[]): string {
  if (tests.length === 0) return "No quarantined tests.";
  const lines = tests.map(
    (t) => `${t.suite} > ${t.testName}  [${t.reason}]  ${t.createdAt.toISOString()}`
  );
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/commands/quarantine.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Wire quarantine command into main.ts**

Add to `src/cli/main.ts`:

```typescript
import { runQuarantine, formatQuarantineTable } from "./commands/quarantine.js";
```

Add command:

```typescript
program
  .command("quarantine")
  .description("Manage quarantined flaky tests")
  .option("--add <test>", "Add test to quarantine (format: suite>testName)")
  .option("--remove <test>", "Remove test from quarantine")
  .option("--auto", "Auto-quarantine based on flaky threshold")
  .action(async (opts: { add?: string; remove?: string; auto?: boolean }) => {
    const config = loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();
    try {
      if (opts.add) {
        const [suite, testName] = opts.add.split(">");
        await runQuarantine({ store, action: "add", suite: suite.trim(), testName: testName.trim() });
        console.log(`Quarantined: ${opts.add}`);
      } else if (opts.remove) {
        const [suite, testName] = opts.remove.split(">");
        await runQuarantine({ store, action: "remove", suite: suite.trim(), testName: testName.trim() });
        console.log(`Removed from quarantine: ${opts.remove}`);
      } else if (opts.auto) {
        await runQuarantine({
          store, action: "auto",
          flakyRateThreshold: config.quarantine.flaky_rate_threshold,
          minRuns: config.quarantine.min_runs,
          windowDays: config.flaky.window_days,
        });
        const q = await store.queryQuarantined();
        console.log(`Auto-quarantined ${q.length} tests`);
      } else {
        const result = await runQuarantine({ store, action: "list" });
        if (result) console.log(formatQuarantineTable(result));
      }
    } finally {
      await store.close();
    }
  });
```

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/quarantine.ts tests/commands/quarantine.test.ts src/cli/main.ts
git commit -m "feat: add quarantine command with auto/manual modes"
```

---

### Task 5: Flaky Trend

**Files:**
- Create: `tests/commands/flaky-trend.test.ts`
- Modify: `src/cli/commands/flaky.ts` (add trend query and formatting)
- Modify: `src/cli/storage/duckdb.ts` (add trend query method)
- Modify: `src/cli/storage/types.ts` (add TrendEntry type)

- [ ] **Step 1: Write failing test**

Create `tests/commands/flaky-trend.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runFlakyTrend } from "../../src/cli/commands/flaky.js";

describe("flaky --trend", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("returns weekly trend data", async () => {
    await store.insertWorkflowRun({
      id: 1, repo: "test/repo", branch: "main", commitSha: "abc",
      event: "push", status: "completed", createdAt: new Date("2026-03-01"), durationMs: 1000,
    });

    const results = [];
    // Week 1: 2 fails, 3 passes
    for (let i = 0; i < 5; i++) {
      results.push({
        workflowRunId: 1, suite: "tests/login.spec.ts", testName: "should redirect",
        status: i < 2 ? "failed" : "passed", durationMs: 100, retryCount: 0,
        errorMessage: null, commitSha: "abc", variant: null,
        createdAt: new Date("2026-03-02"),
      });
    }
    // Week 2: 1 fail, 4 passes
    for (let i = 0; i < 5; i++) {
      results.push({
        workflowRunId: 1, suite: "tests/login.spec.ts", testName: "should redirect",
        status: i < 1 ? "failed" : "passed", durationMs: 100, retryCount: 0,
        errorMessage: null, commitSha: "abc", variant: null,
        createdAt: new Date("2026-03-09"),
      });
    }
    await store.insertTestResults(results);

    const trend = await runFlakyTrend({ store, suite: "tests/login.spec.ts", testName: "should redirect" });
    expect(trend.length).toBeGreaterThanOrEqual(2);
    // First week has higher flaky rate
    const w1 = trend.find((t) => t.week.includes("2026-02") || t.week.includes("2026-03-02"));
    const w2 = trend.find((t) => t.week.includes("2026-03-09"));
    if (w1 && w2) {
      expect(w1.flakyRate).toBeGreaterThan(w2.flakyRate);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/commands/flaky-trend.test.ts`
Expected: FAIL — runFlakyTrend not found

- [ ] **Step 3: Add TrendEntry type**

Add to `src/cli/storage/types.ts`:

```typescript
export interface TrendEntry {
  suite: string;
  testName: string;
  week: string;
  runs: number;
  flakyRate: number;
}
```

- [ ] **Step 4: Add trend query to DuckDBStore**

Add to `src/cli/storage/duckdb.ts`:

```typescript
  async queryFlakyTrend(suite: string, testName: string): Promise<TrendEntry[]> {
    const rows = await this.all(
      `SELECT
        suite,
        test_name,
        DATE_TRUNC('week', created_at)::VARCHAR AS week,
        COUNT(*)::INTEGER AS runs,
        ROUND(
          COUNT(*) FILTER (WHERE status = 'failed') * 100.0 / COUNT(*), 2
        )::DOUBLE AS flaky_rate
      FROM test_results
      WHERE suite = ? AND test_name = ?
      GROUP BY suite, test_name, week
      ORDER BY week`,
      [suite, testName]
    );
    return rows.map((r: any) => ({
      suite: r.suite,
      testName: r.test_name,
      week: r.week,
      runs: r.runs,
      flakyRate: r.flaky_rate,
    }));
  }
```

Add `queryFlakyTrend` to `MetricStore` interface.

- [ ] **Step 5: Add runFlakyTrend to flaky command**

Add to `src/cli/commands/flaky.ts`:

```typescript
import type { TrendEntry } from "../storage/types.js";

interface FlakyTrendOpts {
  store: MetricStore;
  suite: string;
  testName: string;
}

export async function runFlakyTrend(opts: FlakyTrendOpts): Promise<TrendEntry[]> {
  return opts.store.queryFlakyTrend(opts.suite, opts.testName);
}

export function formatFlakyTrend(entries: TrendEntry[]): string {
  if (entries.length === 0) return "No trend data found.";
  const lines = entries.map((e) => `${e.week}  ${e.flakyRate.toFixed(1)}%  (${e.runs} runs)`);
  return lines.join("\n");
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run tests/commands/flaky-trend.test.ts`
Expected: PASS

- [ ] **Step 7: Wire --trend flag in main.ts**

Add `--trend` option to the flaky command in `src/cli/main.ts` and call `runFlakyTrend` when present. Requires `--test` flag with `--trend`.

- [ ] **Step 8: Commit**

```bash
git add src/cli/storage/ src/cli/commands/flaky.ts tests/commands/flaky-trend.test.ts src/cli/main.ts
git commit -m "feat: add flaky --trend for weekly flaky rate visualization"
```

---

### Task 6: Hybrid Sampling Strategy (MoonBit + TypeScript)

**Files:**
- Modify: `src/core/src/sampler/sampler.mbt` (add hybrid sampler)
- Modify: `src/core/src/sampler/sampler_test.mbt` (add hybrid test)
- Modify: `src/core/src/main/main.mbt` (add hybrid export)
- Modify: `src/cli/core/loader.ts` (add hybrid to MetriciCore)
- Modify: `src/cli/commands/sample.ts` (add affected/hybrid mode)
- Create: `tests/commands/sample-hybrid.test.ts`

- [ ] **Step 1: Write MoonBit hybrid test**

Add to `src/core/src/sampler/sampler_test.mbt`:

```moonbit
test "hybrid sampling prioritizes affected, failed, new, then weighted" {
  let meta : Array[@types.TestMeta] = [
    { suite: "affected.spec.ts", test_name: "affected", flaky_rate: 0.0, total_runs: 10, fail_count: 0, last_run_at: "", avg_duration_ms: 100, previously_failed: false, is_new: false },
    { suite: "failed.spec.ts", test_name: "prev_failed", flaky_rate: 50.0, total_runs: 10, fail_count: 5, last_run_at: "", avg_duration_ms: 100, previously_failed: true, is_new: false },
    { suite: "new.spec.ts", test_name: "new_test", flaky_rate: 0.0, total_runs: 0, fail_count: 0, last_run_at: "", avg_duration_ms: 100, previously_failed: false, is_new: true },
    { suite: "stable.spec.ts", test_name: "stable", flaky_rate: 0.0, total_runs: 100, fail_count: 0, last_run_at: "", avg_duration_ms: 100, previously_failed: false, is_new: false },
    { suite: "flaky.spec.ts", test_name: "flaky", flaky_rate: 80.0, total_runs: 100, fail_count: 80, last_run_at: "", avg_duration_ms: 100, previously_failed: false, is_new: false },
  ]

  let affected_suites = ["affected.spec.ts"]
  let result = sample_hybrid(meta, affected_suites~, count~=4, seed~=42UL)
  assert_eq!(result.length(), 4)
  // affected, previously_failed, and new should always be included
  let suites = result.map(fn(m) { m.suite })
  assert_true!(suites.contains("affected.spec.ts"))
  assert_true!(suites.contains("failed.spec.ts"))
  assert_true!(suites.contains("new.spec.ts"))
}
```

- [ ] **Step 2: Run MoonBit test to verify it fails**

Run: `cd src/core && moon test`
Expected: FAIL — sample_hybrid not found

- [ ] **Step 3: Implement hybrid sampler in MoonBit**

Add to `src/core/src/sampler/sampler.mbt`:

```moonbit
pub fn sample_hybrid(
  meta : Array[@types.TestMeta],
  affected_suites~ : Array[String],
  count~ : Int,
  seed~ : UInt64
) -> Array[@types.TestMeta] {
  let affected_set : Map[String, Bool] = {}
  for s in affected_suites {
    affected_set.set(s, true)
  }

  let selected : Array[@types.TestMeta] = []
  let used : Map[Int, Bool] = {}

  // Priority 1: affected tests
  for i, m in meta {
    if affected_set.contains(m.suite) && !used.contains(i) {
      selected.push(m)
      used.set(i, true)
    }
  }

  // Priority 2: previously failed tests
  for i, m in meta {
    if m.previously_failed && !used.contains(i) {
      selected.push(m)
      used.set(i, true)
    }
  }

  // Priority 3: new tests
  for i, m in meta {
    if m.is_new && !used.contains(i) {
      selected.push(m)
      used.set(i, true)
    }
  }

  // Priority 4: fill remaining with weighted random
  if selected.length() < count {
    let remaining : Array[@types.TestMeta] = []
    let remaining_indices : Array[Int] = []
    for i, m in meta {
      if !used.contains(i) {
        remaining.push(m)
        remaining_indices.push(i)
      }
    }
    let needed = count - selected.length()
    let extra = sample_weighted(remaining, count~=needed, seed~)
    for m in extra {
      selected.push(m)
    }
  }

  // Limit to count
  if selected.length() > count {
    Array::makei(count, fn(i) { selected[i] })
  } else {
    selected
  }
}
```

- [ ] **Step 4: Run MoonBit tests**

Run: `cd src/core && moon test`
Expected: All tests PASS

- [ ] **Step 5: Add hybrid export in main.mbt**

Add to `src/core/src/main/main.mbt`:

```moonbit
pub fn sample_hybrid_json(meta_json : String, affected_json : String, count : Int, seed : Int) -> String {
  let meta : Array[@types.TestMeta] = @json.from_json!(try @json.parse!(meta_json))
  let affected : Array[String] = @json.from_json!(try @json.parse!(affected_json))
  let result = @sampler.sample_hybrid(meta, affected_suites~=affected, count~, seed~=seed.to_uint64())
  result.to_json().stringify()
}
```

Add to `link.js.exports` in `src/core/src/main/moon.pkg`:

```
"sample_hybrid_json": "sample_hybrid_json"
```

- [ ] **Step 6: Build MoonBit JS**

Run: `cd src/core && moon build --target js`
Verify: `node -e "import('./src/core/_build/js/debug/build/src/main/main.js').then(m => console.log(Object.keys(m)))"`
Expected: includes `sample_hybrid_json`

- [ ] **Step 7: Add hybrid to TypeScript loader and sample command**

Add `sampleHybrid` to `MetriciCore` interface in `src/cli/core/loader.ts`:

```typescript
export interface MetriciCore {
  detectFlaky(input: DetectInput): DetectOutput;
  sampleRandom(meta: TestMeta[], count: number, seed: number): TestMeta[];
  sampleWeighted(meta: TestMeta[], count: number, seed: number): TestMeta[];
  sampleHybrid(meta: TestMeta[], affectedSuites: string[], count: number, seed: number): TestMeta[];
}
```

Add hybrid to the TS fallback and MoonBit wrapper.

Update `src/cli/commands/sample.ts` to support `mode: "affected" | "hybrid"` by accepting a `DependencyResolver` and changed files list. The hybrid mode calls `resolver.resolve()` to get affected suites, then passes them to `core.sampleHybrid()`.

- [ ] **Step 8: Write TypeScript hybrid test**

Create `tests/commands/sample-hybrid.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runSample } from "../../src/cli/commands/sample.js";
import { SimpleResolver } from "../../src/cli/resolvers/simple.js";

describe("hybrid sampling", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();

    await store.insertWorkflowRun({
      id: 1, repo: "test/repo", branch: "main", commitSha: "abc",
      event: "push", status: "completed", createdAt: new Date(), durationMs: 1000,
    });
    // 10 tests, 2 flaky, 1 new (single run)
    for (let t = 0; t < 10; t++) {
      const runs = t === 9 ? 1 : 10; // test 9 is "new"
      for (let r = 0; r < runs; r++) {
        await store.insertTestResults([{
          workflowRunId: 1,
          suite: `tests/module_${t}/test.spec.ts`,
          testName: `test_${t}`,
          status: (t < 2 && r < 4) ? "failed" : "passed",
          durationMs: 100, retryCount: 0, errorMessage: null,
          commitSha: "abc", variant: null, createdAt: new Date(),
        }]);
      }
    }
  });

  afterEach(async () => {
    await store.close();
  });

  it("hybrid includes affected + failed + new + weighted", async () => {
    const resolver = new SimpleResolver();
    const result = await runSample({
      store,
      mode: "hybrid",
      count: 5,
      resolver,
      changedFiles: ["src/module_3/foo.ts"], // affects tests/module_3/test.spec.ts
    });
    expect(result.length).toBe(5);
    const suites = result.map((r) => r.suite);
    // module_3 should be affected
    expect(suites).toContain("tests/module_3/test.spec.ts");
  });
});
```

- [ ] **Step 9: Run all tests**

Run: `pnpm vitest run`
Expected: All tests PASS

- [ ] **Step 10: Commit**

```bash
git add src/core/ src/cli/ tests/
git commit -m "feat: add hybrid sampling strategy with affected + failed + new + weighted"
```

---

### Task 7: actrun Runner

**Files:**
- Create: `src/cli/runners/actrun.ts`
- Create: `tests/runners/actrun.test.ts`
- Modify: `src/cli/commands/run.ts` (add --runner actrun)
- Modify: `src/cli/main.ts` (add --runner flag)

- [ ] **Step 1: Write failing test**

Create `tests/runners/actrun.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ActrunRunner } from "../../src/cli/runners/actrun.js";

describe("ActrunRunner", () => {
  it("constructs correct actrun command for run", () => {
    const runner = new ActrunRunner({
      workflow: ".github/workflows/test.yml",
      exec: (cmd: string) => {
        expect(cmd).toContain("actrun workflow run");
        expect(cmd).toContain(".github/workflows/test.yml");
        return "";
      },
    });
    runner.run("should redirect");
  });

  it("constructs retry command", () => {
    const runner = new ActrunRunner({
      workflow: ".github/workflows/test.yml",
      exec: (cmd: string) => {
        expect(cmd).toContain("--retry");
        return "";
      },
    });
    runner.retry();
  });

  it("passes job filter when specified", () => {
    const runner = new ActrunRunner({
      workflow: ".github/workflows/test.yml",
      job: "test",
      exec: (cmd: string) => {
        expect(cmd).toContain("--job test");
        return "";
      },
    });
    runner.run("should redirect");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/runners/actrun.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ActrunRunner**

Create `src/cli/runners/actrun.ts`:

```typescript
import { execSync } from "node:child_process";

interface ActrunRunnerOpts {
  workflow: string;
  job?: string;
  exec?: (cmd: string) => string;
}

export class ActrunRunner {
  private workflow: string;
  private job?: string;
  private execFn: (cmd: string) => string;

  constructor(opts: ActrunRunnerOpts) {
    this.workflow = opts.workflow;
    this.job = opts.job;
    this.execFn =
      opts.exec ??
      ((cmd: string) => execSync(cmd, { encoding: "utf-8", stdio: "inherit" }) ?? "");
  }

  run(pattern: string): void {
    const parts = ["actrun workflow run", this.workflow];
    if (this.job) parts.push(`--job ${this.job}`);
    // actrun doesn't have --grep, but we can pass env or use pattern matching
    // For now, just execute the workflow
    this.execFn(parts.join(" "));
  }

  retry(): void {
    const parts = ["actrun workflow run", this.workflow, "--retry"];
    if (this.job) parts.push(`--job ${this.job}`);
    this.execFn(parts.join(" "));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/runners/actrun.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Update run command and main.ts**

Add `--runner` and `--retry` options to the run command in `src/cli/main.ts`. When `--runner actrun` is specified, use `ActrunRunner` instead of `DirectRunner`. When `--retry` is specified, call `actrunRunner.retry()`.

- [ ] **Step 6: Commit**

```bash
git add src/cli/runners/actrun.ts tests/runners/actrun.test.ts src/cli/commands/run.ts src/cli/main.ts
git commit -m "feat: add actrun runner with retry support"
```

---

### Task 8: Bisect Command

**Files:**
- Create: `src/cli/commands/bisect.ts`
- Create: `tests/commands/bisect.test.ts`
- Modify: `src/cli/main.ts` (add bisect command)

- [ ] **Step 1: Write failing test**

Create `tests/commands/bisect.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runBisect } from "../../src/cli/commands/bisect.js";

describe("bisect command", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("identifies commit range where flaky started", async () => {
    // Commits in order: sha1 (ok), sha2 (ok), sha3 (flaky starts), sha4 (flaky), sha5 (flaky)
    const commits = ["sha1", "sha2", "sha3", "sha4", "sha5"];
    for (let i = 0; i < commits.length; i++) {
      await store.insertWorkflowRun({
        id: i + 1, repo: "test/repo", branch: "main", commitSha: commits[i],
        event: "push", status: "completed",
        createdAt: new Date(2026, 2, i + 1), durationMs: 1000,
      });
      await store.insertTestResults([{
        workflowRunId: i + 1, suite: "tests/login.spec.ts", testName: "should redirect",
        status: i >= 2 ? "failed" : "passed", // flaky starts at sha3
        durationMs: 100, retryCount: 0, errorMessage: i >= 2 ? "Timeout" : null,
        commitSha: commits[i], variant: null,
        createdAt: new Date(2026, 2, i + 1),
      }]);
    }

    const result = await runBisect({
      store,
      suite: "tests/login.spec.ts",
      testName: "should redirect",
    });

    expect(result).not.toBeNull();
    expect(result!.lastGoodCommit).toBe("sha2");
    expect(result!.firstBadCommit).toBe("sha3");
  });

  it("returns null when test has always failed", async () => {
    await store.insertWorkflowRun({
      id: 1, repo: "test/repo", branch: "main", commitSha: "sha1",
      event: "push", status: "completed", createdAt: new Date(), durationMs: 1000,
    });
    await store.insertTestResults([{
      workflowRunId: 1, suite: "tests/x.spec.ts", testName: "test",
      status: "failed", durationMs: 100, retryCount: 0, errorMessage: null,
      commitSha: "sha1", variant: null, createdAt: new Date(),
    }]);

    const result = await runBisect({
      store, suite: "tests/x.spec.ts", testName: "test",
    });
    expect(result).toBeNull();
  });

  it("returns null when test has never failed", async () => {
    await store.insertWorkflowRun({
      id: 1, repo: "test/repo", branch: "main", commitSha: "sha1",
      event: "push", status: "completed", createdAt: new Date(), durationMs: 1000,
    });
    await store.insertTestResults([{
      workflowRunId: 1, suite: "tests/x.spec.ts", testName: "test",
      status: "passed", durationMs: 100, retryCount: 0, errorMessage: null,
      commitSha: "sha1", variant: null, createdAt: new Date(),
    }]);

    const result = await runBisect({
      store, suite: "tests/x.spec.ts", testName: "test",
    });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/commands/bisect.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement bisect command**

Create `src/cli/commands/bisect.ts`:

```typescript
import type { MetricStore } from "../storage/types.js";

interface BisectOpts {
  store: MetricStore;
  suite: string;
  testName: string;
}

export interface BisectResult {
  lastGoodCommit: string;
  firstBadCommit: string;
  lastGoodDate: Date;
  firstBadDate: Date;
}

export async function runBisect(opts: BisectOpts): Promise<BisectResult | null> {
  // Get all commits for this test, ordered by date
  const rows = await opts.store.raw<{
    commit_sha: string;
    created_at: string;
    has_failure: boolean;
  }>(`
    SELECT
      commit_sha,
      MIN(created_at)::VARCHAR AS created_at,
      (COUNT(*) FILTER (WHERE status = 'failed') > 0)::BOOLEAN AS has_failure
    FROM test_results
    WHERE suite = ? AND test_name = ?
    GROUP BY commit_sha
    ORDER BY MIN(created_at) ASC
  `, [opts.suite, opts.testName]);

  if (rows.length === 0) return null;

  // Find the transition: last commit with no failures → first commit with failures
  let lastGoodIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].has_failure) {
      lastGoodIdx = i;
    } else if (lastGoodIdx >= 0) {
      // Found the transition
      return {
        lastGoodCommit: rows[lastGoodIdx].commit_sha,
        firstBadCommit: rows[i].commit_sha,
        lastGoodDate: new Date(rows[lastGoodIdx].created_at),
        firstBadDate: new Date(rows[i].created_at),
      };
    }
  }

  // No transition found (always good or always bad)
  return null;
}

export function formatBisectResult(result: BisectResult | null): string {
  if (!result) return "Could not identify a transition point. Test has always been stable or always failing.";
  return [
    `Last good commit: ${result.lastGoodCommit} (${result.lastGoodDate.toISOString()})`,
    `First bad commit:  ${result.firstBadCommit} (${result.firstBadDate.toISOString()})`,
    ``,
    `The flaky behavior likely started between these two commits.`,
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/commands/bisect.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Wire bisect command into main.ts**

Add to `src/cli/main.ts`:

```typescript
import { runBisect, formatBisectResult } from "./commands/bisect.js";
```

```typescript
program
  .command("bisect")
  .description("Find commit range where a test became flaky")
  .requiredOption("--test <name>", "Test name to bisect")
  .option("--suite <suite>", "Suite (file path) to narrow the search")
  .action(async (opts: { test: string; suite?: string }) => {
    const config = loadConfig(process.cwd());
    const store = new DuckDBStore(resolve(config.storage.path));
    await store.initialize();
    try {
      // If suite not specified, try to find it from the test name
      let suite = opts.suite;
      if (!suite) {
        const matches = await store.raw<{ suite: string }>(
          `SELECT DISTINCT suite FROM test_results WHERE test_name = ? LIMIT 1`,
          [opts.test]
        );
        if (matches.length === 0) {
          console.error(`Test "${opts.test}" not found in database.`);
          process.exit(1);
        }
        suite = matches[0].suite;
      }
      const result = await runBisect({ store, suite, testName: opts.test });
      console.log(formatBisectResult(result));
    } finally {
      await store.close();
    }
  });
```

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/bisect.ts tests/commands/bisect.test.ts src/cli/main.ts
git commit -m "feat: add bisect command to find flaky transition commits"
```

---

### Task 9: Skip-Quarantined in Run & Sample

**Files:**
- Modify: `src/cli/commands/sample.ts` (add skipQuarantined option)
- Modify: `src/cli/commands/run.ts` (pass through skipQuarantined)
- Modify: `src/cli/main.ts` (add --skip-quarantined flag)
- Create: `tests/commands/skip-quarantined.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/commands/skip-quarantined.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { runSample } from "../../src/cli/commands/sample.js";

describe("--skip-quarantined", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();

    await store.insertWorkflowRun({
      id: 1, repo: "test/repo", branch: "main", commitSha: "abc",
      event: "push", status: "completed", createdAt: new Date(), durationMs: 1000,
    });

    for (let t = 0; t < 5; t++) {
      for (let r = 0; r < 10; r++) {
        await store.insertTestResults([{
          workflowRunId: 1,
          suite: `tests/test_${t}.spec.ts`,
          testName: `test_${t}`,
          status: t === 0 && r < 5 ? "failed" : "passed",
          durationMs: 100, retryCount: 0, errorMessage: null,
          commitSha: "abc", variant: null, createdAt: new Date(),
        }]);
      }
    }

    // Quarantine test_0
    await store.addQuarantine("tests/test_0.spec.ts", "test_0", "manual");
  });

  afterEach(async () => {
    await store.close();
  });

  it("excludes quarantined tests when skipQuarantined=true", async () => {
    const result = await runSample({
      store, mode: "random", count: 10, skipQuarantined: true,
    });
    const suites = result.map((r) => r.suite);
    expect(suites).not.toContain("tests/test_0.spec.ts");
    expect(result.length).toBe(4); // 5 tests - 1 quarantined
  });

  it("includes quarantined tests by default", async () => {
    const result = await runSample({
      store, mode: "random", count: 10,
    });
    const suites = result.map((r) => r.suite);
    expect(suites).toContain("tests/test_0.spec.ts");
    expect(result.length).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/commands/skip-quarantined.test.ts`
Expected: FAIL — skipQuarantined not a valid option

- [ ] **Step 3: Add skipQuarantined to SampleOpts**

Update `src/cli/commands/sample.ts`:

Add `skipQuarantined?: boolean` to `SampleOpts`.

In `runSample`, after building `allTests`, filter out quarantined tests:

```typescript
if (opts.skipQuarantined) {
  const quarantined = await opts.store.queryQuarantined();
  const qSet = new Set(quarantined.map((q) => `${q.suite}\0${q.testName}`));
  allTests = allTests.filter((t) => !qSet.has(`${t.suite}\0${t.test_name}`));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/commands/skip-quarantined.test.ts`
Expected: 2 tests PASS

- [ ] **Step 5: Add --skip-quarantined flag to main.ts**

Add `.option("--skip-quarantined", "Exclude quarantined tests")` to both `sample` and `run` commands.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/sample.ts src/cli/commands/run.ts src/cli/main.ts tests/commands/skip-quarantined.test.ts
git commit -m "feat: add --skip-quarantined flag to sample and run commands"
```

---

### Task 10: Phase 2 Integration Test

**Files:**
- Create: `tests/integration-phase2.test.ts`

- [ ] **Step 1: Write integration test**

Create `tests/integration-phase2.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../src/cli/storage/duckdb.js";
import { runQuarantine } from "../src/cli/commands/quarantine.js";
import { runBisect } from "../src/cli/commands/bisect.js";
import { runSample } from "../src/cli/commands/sample.js";
import { SimpleResolver } from "../src/cli/resolvers/simple.js";

describe("Phase 2 integration", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();

    // Create 5 workflow runs with commits sha1-sha5
    for (let i = 0; i < 5; i++) {
      await store.insertWorkflowRun({
        id: i + 1, repo: "test/repo", branch: "main", commitSha: `sha${i + 1}`,
        event: "push", status: "completed",
        createdAt: new Date(2026, 2, i + 1), durationMs: 60000,
      });
    }

    // 10 tests across 5 runs
    for (let run = 0; run < 5; run++) {
      for (let t = 0; t < 10; t++) {
        const isFlaky = t < 2; // first 2 tests are flaky starting at sha3
        const isFailing = isFlaky && run >= 2;
        await store.insertTestResults([{
          workflowRunId: run + 1,
          suite: `tests/module_${t}/test.spec.ts`,
          testName: `test_${t}`,
          status: isFailing ? "failed" : "passed",
          durationMs: 100, retryCount: 0,
          errorMessage: isFailing ? "Timeout" : null,
          commitSha: `sha${run + 1}`, variant: null,
          createdAt: new Date(2026, 2, run + 1),
        }]);
      }
    }
  });

  afterEach(async () => {
    await store.close();
  });

  it("auto-quarantine identifies flaky tests", async () => {
    await runQuarantine({
      store, action: "auto",
      flakyRateThreshold: 30.0, minRuns: 3, windowDays: 30,
    });
    const q = await store.queryQuarantined();
    expect(q.length).toBeGreaterThanOrEqual(1);
    expect(q.map((x) => x.suite)).toContain("tests/module_0/test.spec.ts");
  });

  it("bisect finds transition for flaky test", async () => {
    const result = await runBisect({
      store, suite: "tests/module_0/test.spec.ts", testName: "test_0",
    });
    expect(result).not.toBeNull();
    expect(result!.lastGoodCommit).toBe("sha2");
    expect(result!.firstBadCommit).toBe("sha3");
  });

  it("hybrid sample with skip-quarantined", async () => {
    // Quarantine the flaky tests
    await store.addQuarantine("tests/module_0/test.spec.ts", "test_0", "auto");

    const resolver = new SimpleResolver();
    const result = await runSample({
      store, mode: "hybrid", count: 5,
      resolver, changedFiles: ["src/module_3/foo.ts"],
      skipQuarantined: true,
    });

    const suites = result.map((r) => r.suite);
    // Quarantined test should not be included
    expect(suites).not.toContain("tests/module_0/test.spec.ts");
    // Affected test should be included
    expect(suites).toContain("tests/module_3/test.spec.ts");
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `pnpm vitest run`
Expected: All tests PASS

Run: `cd src/core && moon test`
Expected: All MoonBit tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration-phase2.test.ts
git commit -m "feat: add Phase 2 integration test"
```
