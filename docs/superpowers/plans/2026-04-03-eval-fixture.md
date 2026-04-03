# Evaluation Fixture Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a synthetic data generator and evaluation pipeline to measure co-failure tracking accuracy with controlled parameters.

**Architecture:** A fixture generator creates deterministic test history data in DuckDB. An evaluator runs `planSample` with different strategies on the same data and compares results against ground truth. A reporter formats the comparison as a markdown table.

**Tech Stack:** TypeScript, DuckDB (in-memory), vitest, existing `planSample` from `src/cli/commands/sample.ts`

---

### Task 1: Fixture Generator

**Files:**
- Create: `src/cli/eval/fixture-generator.ts`
- Test: `tests/eval/fixture-generator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/eval/fixture-generator.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { generateFixture, type FixtureConfig } from "../../src/cli/eval/fixture-generator.js";

const defaultConfig: FixtureConfig = {
  testCount: 20,
  commitCount: 10,
  flakyRate: 0.1,
  coFailureStrength: 0.8,
  filesPerCommit: 2,
  testsPerFile: 4,
  samplePercentage: 20,
  seed: 42,
};

describe("generateFixture", () => {
  it("generates correct number of tests and commits", () => {
    const fixture = generateFixture(defaultConfig);
    expect(fixture.tests.length).toBe(20);
    expect(fixture.commits.length).toBe(10);
  });

  it("generates file-to-test dependency map", () => {
    const fixture = generateFixture(defaultConfig);
    expect(fixture.fileDeps.size).toBeGreaterThan(0);
    // Each file maps to testsPerFile tests
    for (const [, tests] of fixture.fileDeps) {
      expect(tests.length).toBe(4);
    }
  });

  it("marks correct number of flaky tests", () => {
    const fixture = generateFixture(defaultConfig);
    const flakyCount = fixture.tests.filter((t) => t.isFlaky).length;
    expect(flakyCount).toBe(2); // 20 * 0.1 = 2
  });

  it("generates commit changes and test results", () => {
    const fixture = generateFixture(defaultConfig);
    for (const commit of fixture.commits) {
      expect(commit.changedFiles.length).toBe(2); // filesPerCommit
      expect(commit.testResults.length).toBe(20); // all tests run per commit
    }
  });

  it("is deterministic with same seed", () => {
    const a = generateFixture(defaultConfig);
    const b = generateFixture(defaultConfig);
    expect(a.commits.map((c) => c.sha)).toEqual(b.commits.map((c) => c.sha));
    expect(a.commits.map((c) => c.testResults.map((r) => r.status))).toEqual(
      b.commits.map((c) => c.testResults.map((r) => r.status)),
    );
  });

  it("co-failure strength controls failure correlation", () => {
    const strong = generateFixture({ ...defaultConfig, coFailureStrength: 1.0, commitCount: 50 });
    const none = generateFixture({ ...defaultConfig, coFailureStrength: 0.0, commitCount: 50 });

    // With strength=1.0, dependent tests should fail when their file changes
    const strongFailures = strong.commits.flatMap((c) => c.testResults.filter((r) => r.status === "failed"));
    const noneFailures = none.commits.flatMap((c) => c.testResults.filter((r) => r.status === "failed"));

    // Strong co-failure should produce more failures (dependent tests always fail)
    expect(strongFailures.length).toBeGreaterThan(noneFailures.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/eval/fixture-generator.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement fixture generator**

Create `src/cli/eval/fixture-generator.ts`:

```typescript
export interface FixtureConfig {
  testCount: number;
  commitCount: number;
  flakyRate: number;
  coFailureStrength: number;
  filesPerCommit: number;
  testsPerFile: number;
  samplePercentage: number;
  seed: number;
}

export interface FixtureTest {
  suite: string;
  testName: string;
  isFlaky: boolean;
}

interface FixtureCommitResult {
  suite: string;
  testName: string;
  status: "passed" | "failed";
}

export interface FixtureCommit {
  sha: string;
  changedFiles: { filePath: string; changeType: string }[];
  testResults: FixtureCommitResult[];
}

export interface FixtureData {
  tests: FixtureTest[];
  files: string[];
  fileDeps: Map<string, string[]>; // file -> test suites
  commits: FixtureCommit[];
  config: FixtureConfig;
}

function lcgNext(state: number): { next: number; value: number } {
  const next = (state * 1664525 + 1013904223) >>> 0;
  return { next, value: next / 0x100000000 };
}

export function generateFixture(config: FixtureConfig): FixtureData {
  let rng = config.seed >>> 0;
  function rand(): number {
    const r = lcgNext(rng);
    rng = r.next;
    return r.value;
  }

  // Generate files
  const fileCount = Math.max(1, Math.ceil(config.testCount / config.testsPerFile));
  const files: string[] = [];
  for (let i = 0; i < fileCount; i++) {
    files.push(`src/module_${i}.ts`);
  }

  // Generate tests and assign to files
  const tests: FixtureTest[] = [];
  const fileDeps = new Map<string, string[]>();
  for (let i = 0; i < fileCount; i++) {
    fileDeps.set(files[i], []);
  }

  const flakyCount = Math.round(config.testCount * config.flakyRate);
  for (let i = 0; i < config.testCount; i++) {
    const fileIdx = i % fileCount;
    const suite = `tests/module_${fileIdx}/test_${i}.spec.ts`;
    tests.push({
      suite,
      testName: `test_${i}`,
      isFlaky: i < flakyCount,
    });
    fileDeps.get(files[fileIdx])!.push(suite);
  }

  // Generate commits
  const commits: FixtureCommit[] = [];
  for (let c = 0; c < config.commitCount; c++) {
    const sha = `fixture-sha-${c.toString().padStart(4, "0")}`;

    // Pick random files to change
    const changedFiles: { filePath: string; changeType: string }[] = [];
    const changedFileSet = new Set<string>();
    for (let f = 0; f < config.filesPerCommit; f++) {
      const idx = Math.floor(rand() * fileCount);
      const file = files[idx];
      if (!changedFileSet.has(file)) {
        changedFileSet.add(file);
        changedFiles.push({ filePath: file, changeType: "modified" });
      }
    }

    // Determine test results
    const dependentSuites = new Set<string>();
    for (const file of changedFileSet) {
      for (const suite of fileDeps.get(file) ?? []) {
        dependentSuites.add(suite);
      }
    }

    const testResults: FixtureCommitResult[] = tests.map((test) => {
      const isDependent = dependentSuites.has(test.suite);
      let failed = false;

      // Co-failure: dependent test fails with probability = coFailureStrength
      if (isDependent && rand() < config.coFailureStrength) {
        failed = true;
      }

      // Flaky: fails with flakyRate regardless of dependency
      if (test.isFlaky && rand() < config.flakyRate) {
        failed = true;
      }

      return {
        suite: test.suite,
        testName: test.testName,
        status: failed ? "failed" : "passed",
      };
    });

    commits.push({ sha, changedFiles, testResults });
  }

  return { tests, files, fileDeps, commits, config };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/eval/fixture-generator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/eval/fixture-generator.ts tests/eval/fixture-generator.test.ts
git commit -m "feat: add synthetic fixture generator for evaluation"
```

---

### Task 2: Fixture Data Loader (DuckDB)

**Files:**
- Create: `src/cli/eval/fixture-loader.ts`
- Test: `tests/eval/fixture-loader.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/eval/fixture-loader.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { generateFixture, type FixtureConfig } from "../../src/cli/eval/fixture-generator.js";
import { loadFixtureIntoStore } from "../../src/cli/eval/fixture-loader.js";

const config: FixtureConfig = {
  testCount: 20,
  commitCount: 10,
  flakyRate: 0.1,
  coFailureStrength: 0.8,
  filesPerCommit: 2,
  testsPerFile: 4,
  samplePercentage: 20,
  seed: 42,
};

describe("loadFixtureIntoStore", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("loads all workflow runs", async () => {
    const fixture = generateFixture(config);
    await loadFixtureIntoStore(store, fixture);

    const rows = await store.raw<{ cnt: number }>(
      "SELECT COUNT(*)::INTEGER AS cnt FROM workflow_runs",
    );
    expect(rows[0].cnt).toBe(10);
  });

  it("loads all test results", async () => {
    const fixture = generateFixture(config);
    await loadFixtureIntoStore(store, fixture);

    const rows = await store.raw<{ cnt: number }>(
      "SELECT COUNT(*)::INTEGER AS cnt FROM test_results",
    );
    // 10 commits * 20 tests = 200
    expect(rows[0].cnt).toBe(200);
  });

  it("loads all commit changes", async () => {
    const fixture = generateFixture(config);
    await loadFixtureIntoStore(store, fixture);

    const rows = await store.raw<{ cnt: number }>(
      "SELECT COUNT(*)::INTEGER AS cnt FROM commit_changes",
    );
    expect(rows[0].cnt).toBeGreaterThan(0);
  });

  it("co-failure query returns results after loading", async () => {
    const fixture = generateFixture(config);
    await loadFixtureIntoStore(store, fixture);

    const coFailures = await store.queryCoFailures({ windowDays: 365, minCoRuns: 2 });
    expect(coFailures.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/eval/fixture-loader.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement loader**

Create `src/cli/eval/fixture-loader.ts`:

```typescript
import type { MetricStore } from "../storage/types.js";
import type { FixtureData } from "./fixture-generator.js";

export async function loadFixtureIntoStore(
  store: MetricStore,
  fixture: FixtureData,
): Promise<void> {
  const baseTime = Date.now() - fixture.commits.length * 86400000;

  for (let i = 0; i < fixture.commits.length; i++) {
    const commit = fixture.commits[i];
    const createdAt = new Date(baseTime + i * 86400000);
    const runId = i + 1;

    await store.insertWorkflowRun({
      id: runId,
      repo: "fixture/repo",
      branch: "main",
      commitSha: commit.sha,
      event: "push",
      status: "completed",
      createdAt,
      durationMs: 60000,
    });

    await store.insertCommitChanges(
      commit.sha,
      commit.changedFiles.map((f) => ({
        filePath: f.filePath,
        changeType: f.changeType,
        additions: 10,
        deletions: 5,
      })),
    );

    await store.insertTestResults(
      commit.testResults.map((r) => ({
        workflowRunId: runId,
        suite: r.suite,
        testName: r.testName,
        status: r.status,
        durationMs: 100,
        retryCount: 0,
        errorMessage: r.status === "failed" ? "fixture failure" : null,
        commitSha: commit.sha,
        variant: null,
        createdAt,
      })),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/eval/fixture-loader.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/eval/fixture-loader.ts tests/eval/fixture-loader.test.ts
git commit -m "feat: add fixture data loader for DuckDB"
```

---

### Task 3: Fixture Evaluator

**Files:**
- Create: `src/cli/eval/fixture-evaluator.ts`
- Test: `tests/eval/fixture-evaluator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/eval/fixture-evaluator.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { generateFixture } from "../../src/cli/eval/fixture-generator.js";
import { loadFixtureIntoStore } from "../../src/cli/eval/fixture-loader.js";
import { evaluateFixture, type EvalStrategyResult } from "../../src/cli/eval/fixture-evaluator.js";

describe("evaluateFixture", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("returns results for all strategies", async () => {
    const fixture = generateFixture({
      testCount: 30,
      commitCount: 20,
      flakyRate: 0.1,
      coFailureStrength: 0.8,
      filesPerCommit: 2,
      testsPerFile: 5,
      samplePercentage: 30,
      seed: 42,
    });
    await loadFixtureIntoStore(store, fixture);

    const results = await evaluateFixture(store, fixture);
    expect(results).toHaveLength(3); // random, weighted, weighted+co-failure
    expect(results.map((r) => r.strategy)).toEqual([
      "random",
      "weighted",
      "weighted+co-failure",
    ]);
  });

  it("all strategies have valid metrics", async () => {
    const fixture = generateFixture({
      testCount: 30,
      commitCount: 20,
      flakyRate: 0.1,
      coFailureStrength: 0.8,
      filesPerCommit: 2,
      testsPerFile: 5,
      samplePercentage: 30,
      seed: 42,
    });
    await loadFixtureIntoStore(store, fixture);

    const results = await evaluateFixture(store, fixture);
    for (const result of results) {
      expect(result.recall).toBeGreaterThanOrEqual(0);
      expect(result.recall).toBeLessThanOrEqual(1);
      expect(result.falseNegativeRate).toBeGreaterThanOrEqual(0);
      expect(result.falseNegativeRate).toBeLessThanOrEqual(1);
      expect(result.sampleRatio).toBeGreaterThan(0);
      expect(result.sampleRatio).toBeLessThanOrEqual(1);
    }
  });

  it("co-failure strategy outperforms random when correlation is strong", async () => {
    const fixture = generateFixture({
      testCount: 50,
      commitCount: 40,
      flakyRate: 0.05,
      coFailureStrength: 1.0,
      filesPerCommit: 2,
      testsPerFile: 5,
      samplePercentage: 20,
      seed: 42,
    });
    await loadFixtureIntoStore(store, fixture);

    const results = await evaluateFixture(store, fixture);
    const random = results.find((r) => r.strategy === "random")!;
    const coFailure = results.find((r) => r.strategy === "weighted+co-failure")!;

    // With strong co-failure (1.0) and low flaky rate (5%),
    // co-failure strategy should detect more failures
    expect(coFailure.recall).toBeGreaterThanOrEqual(random.recall);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/eval/fixture-evaluator.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement evaluator**

Create `src/cli/eval/fixture-evaluator.ts`:

```typescript
import type { MetricStore } from "../storage/types.js";
import type { FixtureData } from "./fixture-generator.js";
import { planSample } from "../commands/sample.js";

export interface EvalStrategyResult {
  strategy: string;
  recall: number;
  precision: number;
  f1: number;
  falseNegativeRate: number;
  sampleRatio: number;
  efficiency: number;
  totalFailures: number;
  detectedFailures: number;
  totalSampled: number;
}

export async function evaluateFixture(
  store: MetricStore,
  fixture: FixtureData,
): Promise<EvalStrategyResult[]> {
  const strategies = [
    { name: "random", mode: "random" as const, useCoFailure: false },
    { name: "weighted", mode: "weighted" as const, useCoFailure: false },
    { name: "weighted+co-failure", mode: "weighted" as const, useCoFailure: true },
  ];

  // Use last 25% of commits as evaluation set
  const evalStart = Math.floor(fixture.commits.length * 0.75);
  const evalCommits = fixture.commits.slice(evalStart);
  const sampleCount = Math.round(
    fixture.tests.length * (fixture.config.samplePercentage / 100),
  );

  const results: EvalStrategyResult[] = [];

  for (const strategy of strategies) {
    let totalFailures = 0;
    let detectedFailures = 0;
    let totalSampled = 0;
    let totalSampledFailures = 0;

    for (const commit of evalCommits) {
      const changedFiles = strategy.useCoFailure
        ? commit.changedFiles.map((f) => f.filePath)
        : undefined;

      const plan = await planSample({
        store,
        count: sampleCount,
        mode: strategy.mode,
        seed: 42,
        changedFiles,
      });

      const sampledSuites = new Set(plan.sampled.map((t) => t.suite));
      const actualFailures = commit.testResults.filter((r) => r.status === "failed");
      const detectedInSample = actualFailures.filter((f) => sampledSuites.has(f.suite));

      totalFailures += actualFailures.length;
      detectedFailures += detectedInSample.length;
      totalSampled += plan.sampled.length;
      totalSampledFailures += plan.sampled.filter((t) =>
        commit.testResults.some((r) => r.suite === t.suite && r.status === "failed"),
      ).length;
    }

    const recall = totalFailures > 0 ? detectedFailures / totalFailures : 1;
    const precision = totalSampled > 0 ? totalSampledFailures / totalSampled : 0;
    const f1 = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;
    const sampleRatio = fixture.tests.length > 0 ? sampleCount / fixture.tests.length : 0;
    const efficiency = sampleRatio > 0 ? recall / sampleRatio : 0;

    results.push({
      strategy: strategy.name,
      recall: Math.round(recall * 1000) / 1000,
      precision: Math.round(precision * 1000) / 1000,
      f1: Math.round(f1 * 1000) / 1000,
      falseNegativeRate: Math.round((1 - recall) * 1000) / 1000,
      sampleRatio: Math.round(sampleRatio * 1000) / 1000,
      efficiency: Math.round(efficiency * 100) / 100,
      totalFailures,
      detectedFailures,
      totalSampled,
    });
  }

  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/eval/fixture-evaluator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/eval/fixture-evaluator.ts tests/eval/fixture-evaluator.test.ts
git commit -m "feat: add fixture evaluator comparing sampling strategies"
```

---

### Task 4: Report Formatter and CLI Command

**Files:**
- Create: `src/cli/eval/fixture-report.ts`
- Modify: `src/cli/main.ts`
- Test: `tests/eval/fixture-report.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/eval/fixture-report.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatEvalFixtureReport, type EvalFixtureReport } from "../../src/cli/eval/fixture-report.js";
import type { EvalStrategyResult } from "../../src/cli/eval/fixture-evaluator.js";
import type { FixtureConfig } from "../../src/cli/eval/fixture-generator.js";

describe("formatEvalFixtureReport", () => {
  it("formats a readable markdown table", () => {
    const config: FixtureConfig = {
      testCount: 500,
      commitCount: 100,
      flakyRate: 0.1,
      coFailureStrength: 0.8,
      filesPerCommit: 2,
      testsPerFile: 5,
      samplePercentage: 20,
      seed: 42,
    };

    const results: EvalStrategyResult[] = [
      {
        strategy: "random",
        recall: 0.2,
        precision: 0.05,
        f1: 0.08,
        falseNegativeRate: 0.8,
        sampleRatio: 0.2,
        efficiency: 1.0,
        totalFailures: 100,
        detectedFailures: 20,
        totalSampled: 400,
      },
      {
        strategy: "weighted",
        recall: 0.35,
        precision: 0.08,
        f1: 0.13,
        falseNegativeRate: 0.65,
        sampleRatio: 0.2,
        efficiency: 1.75,
        totalFailures: 100,
        detectedFailures: 35,
        totalSampled: 400,
      },
      {
        strategy: "weighted+co-failure",
        recall: 0.72,
        precision: 0.15,
        f1: 0.25,
        falseNegativeRate: 0.28,
        sampleRatio: 0.2,
        efficiency: 3.6,
        totalFailures: 100,
        detectedFailures: 72,
        totalSampled: 400,
      },
    ];

    const report: EvalFixtureReport = { config, results };
    const output = formatEvalFixtureReport(report);

    expect(output).toContain("Evaluation Report");
    expect(output).toContain("random");
    expect(output).toContain("weighted+co-failure");
    expect(output).toContain("Recall");
    expect(output).toContain("Efficiency");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/eval/fixture-report.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement report formatter**

Create `src/cli/eval/fixture-report.ts`:

```typescript
import type { FixtureConfig } from "./fixture-generator.js";
import type { EvalStrategyResult } from "./fixture-evaluator.js";

export interface EvalFixtureReport {
  config: FixtureConfig;
  results: EvalStrategyResult[];
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function pad(s: string, width: number): string {
  return s.padEnd(width);
}

export function formatEvalFixtureReport(report: EvalFixtureReport): string {
  const c = report.config;
  const lines: string[] = [
    "# Evaluation Report",
    "",
    `Config: tests=${c.testCount}, commits=${c.commitCount}, flaky=${pct(c.flakyRate)}, co-failure=${c.coFailureStrength}, sample=${c.samplePercentage}%`,
    "",
    `| ${pad("Strategy", 22)} | ${pad("Recall", 8)} | ${pad("Prec", 8)} | ${pad("F1", 6)} | ${pad("FNR", 8)} | ${pad("Sample%", 8)} | ${pad("Efficiency", 10)} |`,
    `|${"-".repeat(24)}|${"-".repeat(10)}|${"-".repeat(10)}|${"-".repeat(8)}|${"-".repeat(10)}|${"-".repeat(10)}|${"-".repeat(12)}|`,
  ];

  for (const r of report.results) {
    lines.push(
      `| ${pad(r.strategy, 22)} | ${pad(pct(r.recall), 8)} | ${pad(pct(r.precision), 8)} | ${pad(r.f1.toFixed(2), 6)} | ${pad(pct(r.falseNegativeRate), 8)} | ${pad(pct(r.sampleRatio), 8)} | ${pad(r.efficiency.toFixed(2), 10)} |`,
    );
  }

  lines.push(
    "",
    `Efficiency = Recall / Sample%. >1.0 means better than random.`,
  );

  return lines.join("\n");
}

export function formatSweepReport(reports: EvalFixtureReport[]): string {
  const lines: string[] = [
    "# Co-failure Strength Sweep",
    "",
    `| ${pad("Strength", 10)} | ${pad("Random", 8)} | ${pad("Weighted", 10)} | ${pad("W+CoFail", 10)} | ${pad("Gain", 6)} |`,
    `|${"-".repeat(12)}|${"-".repeat(10)}|${"-".repeat(12)}|${"-".repeat(12)}|${"-".repeat(8)}|`,
  ];

  for (const report of reports) {
    const random = report.results.find((r) => r.strategy === "random")!;
    const weighted = report.results.find((r) => r.strategy === "weighted")!;
    const coFailure = report.results.find((r) => r.strategy === "weighted+co-failure")!;
    const gain = random.recall > 0
      ? `${((coFailure.recall / random.recall - 1) * 100).toFixed(0)}%`
      : "N/A";

    lines.push(
      `| ${pad(report.config.coFailureStrength.toFixed(2), 10)} | ${pad(pct(random.recall), 8)} | ${pad(pct(weighted.recall), 10)} | ${pad(pct(coFailure.recall), 10)} | ${pad(gain, 6)} |`,
    );
  }

  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/eval/fixture-report.test.ts`
Expected: PASS

- [ ] **Step 5: Add CLI command**

In `src/cli/main.ts`, add the `eval-fixture` command. Find the eval command section and add after it:

```typescript
import { generateFixture } from "./eval/fixture-generator.js";
import { loadFixtureIntoStore } from "./eval/fixture-loader.js";
import { evaluateFixture } from "./eval/fixture-evaluator.js";
import { formatEvalFixtureReport, formatSweepReport } from "./eval/fixture-report.js";
```

Add the command registration:

```typescript
// --- eval-fixture ---
program
  .command("eval-fixture")
  .description("Evaluate sampling strategies with synthetic data")
  .option("--tests <n>", "Number of tests", "100")
  .option("--commits <n>", "Number of commits", "50")
  .option("--flaky-rate <n>", "Flaky rate (0-1)", "0.1")
  .option("--co-failure-strength <n>", "Co-failure correlation (0-1)", "0.8")
  .option("--files-per-commit <n>", "Files changed per commit", "2")
  .option("--tests-per-file <n>", "Tests per source file", "5")
  .option("--sample-percentage <n>", "Sample percentage", "20")
  .option("--seed <n>", "Random seed", "42")
  .option("--sweep", "Sweep co-failure strength 0.0-1.0")
  .action(async (opts) => {
    const baseConfig = {
      testCount: parseInt(opts.tests, 10),
      commitCount: parseInt(opts.commits, 10),
      flakyRate: parseFloat(opts.flakyRate),
      coFailureStrength: parseFloat(opts.coFailureStrength),
      filesPerCommit: parseInt(opts.filesPerCommit, 10),
      testsPerFile: parseInt(opts.testsPerFile, 10),
      samplePercentage: parseInt(opts.samplePercentage, 10),
      seed: parseInt(opts.seed, 10),
    };

    if (opts.sweep) {
      const strengths = [0.0, 0.25, 0.5, 0.75, 1.0];
      const reports = [];
      for (const strength of strengths) {
        const config = { ...baseConfig, coFailureStrength: strength };
        const store = new DuckDBStore(":memory:");
        await store.initialize();
        const fixture = generateFixture(config);
        await loadFixtureIntoStore(store, fixture);
        const results = await evaluateFixture(store, fixture);
        reports.push({ config, results });
        await store.close();
      }
      console.log(formatSweepReport(reports));
    } else {
      const store = new DuckDBStore(":memory:");
      await store.initialize();
      const fixture = generateFixture(baseConfig);
      await loadFixtureIntoStore(store, fixture);
      const results = await evaluateFixture(store, fixture);
      console.log(formatEvalFixtureReport({ config: baseConfig, results }));
      await store.close();
    }
  });
```

- [ ] **Step 6: Run all tests**

Run: `pnpm vitest run tests/eval/`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/cli/eval/fixture-report.ts tests/eval/fixture-report.test.ts src/cli/main.ts
git commit -m "feat: add eval-fixture command with report formatting and sweep mode"
```
