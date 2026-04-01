import type { MetricStore } from "../storage/types.js";
import type { TestMeta } from "../core/loader.js";
import { SimpleResolver } from "../resolvers/simple.js";
import { runSample } from "./sample.js";

// A scenario defines: project structure, test history, code change, and expected test selection
export interface Scenario {
  name: string;
  description: string;
  tests: Array<{
    suite: string;
    testName: string;
    runs: number;
    failures: number;
    retryPasses: number;
    isNew: boolean;
    avgDurationMs: number;
  }>;
  changedFiles: string[];
  expectedMustInclude: string[];
  expectedMustExclude: string[];
  expectedMinCount: number;
  expectedMaxCount: number;
  sampleCount: number;
  strategy: "random" | "weighted" | "affected" | "hybrid";
}

export interface ScenarioResult {
  scenario: string;
  passed: boolean;
  selected: string[];
  issues: string[];
  score: number;
}

export interface SelfEvalReport {
  scenarios: ScenarioResult[];
  overallScore: number;
  improvements: string[];
}

export function getScenarios(): Scenario[] {
  return [
    {
      name: "basic-affected",
      description: "Changing auth module should select auth tests and dependents",
      tests: [
        { suite: "tests/auth/login.spec.ts", testName: "should login", runs: 50, failures: 0, retryPasses: 0, isNew: false, avgDurationMs: 500 },
        { suite: "tests/auth/register.spec.ts", testName: "should register", runs: 50, failures: 0, retryPasses: 0, isNew: false, avgDurationMs: 600 },
        { suite: "tests/home/index.spec.ts", testName: "should load", runs: 50, failures: 0, retryPasses: 0, isNew: false, avgDurationMs: 300 },
        { suite: "tests/checkout/cart.spec.ts", testName: "should add item", runs: 50, failures: 0, retryPasses: 0, isNew: false, avgDurationMs: 800 },
        { suite: "tests/utils/format.spec.ts", testName: "should format", runs: 50, failures: 0, retryPasses: 0, isNew: false, avgDurationMs: 100 },
      ],
      changedFiles: ["src/auth/login.ts", "src/auth/session.ts"],
      expectedMustInclude: ["tests/auth/login.spec.ts", "tests/auth/register.spec.ts"],
      expectedMustExclude: ["tests/home/index.spec.ts"],
      expectedMinCount: 2,
      expectedMaxCount: 5,
      sampleCount: 3,
      strategy: "affected",
    },
    {
      name: "weighted-flaky-priority",
      description: "Weighted sampling should prioritize high flaky-rate tests",
      tests: [
        { suite: "tests/stable.spec.ts", testName: "stable_test", runs: 100, failures: 0, retryPasses: 0, isNew: false, avgDurationMs: 100 },
        { suite: "tests/very-flaky.spec.ts", testName: "flaky_test", runs: 100, failures: 40, retryPasses: 10, isNew: false, avgDurationMs: 2000 },
        { suite: "tests/slightly-flaky.spec.ts", testName: "slight_flaky", runs: 100, failures: 5, retryPasses: 3, isNew: false, avgDurationMs: 500 },
        { suite: "tests/another-stable.spec.ts", testName: "another_stable", runs: 100, failures: 0, retryPasses: 0, isNew: false, avgDurationMs: 200 },
      ],
      changedFiles: [],
      expectedMustInclude: ["tests/very-flaky.spec.ts"],
      expectedMustExclude: [],
      expectedMinCount: 1,
      expectedMaxCount: 2,
      sampleCount: 2,
      strategy: "weighted",
    },
    {
      name: "hybrid-new-and-failed",
      description: "Hybrid should include new tests and previously failed tests",
      tests: [
        { suite: "tests/old-stable.spec.ts", testName: "old_stable", runs: 100, failures: 0, retryPasses: 0, isNew: false, avgDurationMs: 100 },
        { suite: "tests/old-flaky.spec.ts", testName: "old_flaky", runs: 100, failures: 30, retryPasses: 0, isNew: false, avgDurationMs: 500 },
        { suite: "tests/new-test.spec.ts", testName: "brand_new", runs: 1, failures: 0, retryPasses: 0, isNew: true, avgDurationMs: 200 },
        { suite: "tests/recently-broken.spec.ts", testName: "recently_broken", runs: 50, failures: 5, retryPasses: 0, isNew: false, avgDurationMs: 300 },
        { suite: "tests/api/endpoint.spec.ts", testName: "api_test", runs: 80, failures: 0, retryPasses: 0, isNew: false, avgDurationMs: 400 },
        { suite: "tests/utils/helper.spec.ts", testName: "helper_test", runs: 60, failures: 0, retryPasses: 0, isNew: false, avgDurationMs: 150 },
      ],
      changedFiles: ["src/api/endpoint.ts"],
      expectedMustInclude: ["tests/api/endpoint.spec.ts", "tests/new-test.spec.ts"],
      expectedMustExclude: [],
      expectedMinCount: 3,
      expectedMaxCount: 5,
      sampleCount: 4,
      strategy: "hybrid",
    },
    {
      name: "quarantine-skip",
      description: "Quarantined tests should be excluded when skip-quarantined is set",
      tests: [
        { suite: "tests/good.spec.ts", testName: "good_test", runs: 50, failures: 0, retryPasses: 0, isNew: false, avgDurationMs: 100 },
        { suite: "tests/quarantined.spec.ts", testName: "quarantined_test", runs: 50, failures: 25, retryPasses: 0, isNew: false, avgDurationMs: 500 },
        { suite: "tests/another.spec.ts", testName: "another_test", runs: 50, failures: 0, retryPasses: 0, isNew: false, avgDurationMs: 200 },
      ],
      changedFiles: [],
      expectedMustInclude: [],
      expectedMustExclude: ["tests/quarantined.spec.ts"],
      expectedMinCount: 1,
      expectedMaxCount: 2,
      sampleCount: 2,
      strategy: "random",
    },
    {
      name: "regression-detection",
      description: "Recently failing test with history of stability should be prioritized",
      tests: [
        { suite: "tests/stable-forever.spec.ts", testName: "always_passes", runs: 200, failures: 0, retryPasses: 0, isNew: false, avgDurationMs: 100 },
        { suite: "tests/recent-regression.spec.ts", testName: "was_stable_now_fails", runs: 200, failures: 8, retryPasses: 0, isNew: false, avgDurationMs: 500 },
        { suite: "tests/always-flaky.spec.ts", testName: "chronic_flaky", runs: 200, failures: 60, retryPasses: 20, isNew: false, avgDurationMs: 1000 },
        { suite: "tests/moderate.spec.ts", testName: "moderate_test", runs: 100, failures: 2, retryPasses: 0, isNew: false, avgDurationMs: 300 },
      ],
      changedFiles: [],
      expectedMustInclude: ["tests/recent-regression.spec.ts", "tests/always-flaky.spec.ts"],
      expectedMustExclude: [],
      expectedMinCount: 2,
      expectedMaxCount: 3,
      sampleCount: 2,
      strategy: "weighted",
    },
    {
      name: "large-suite-sampling",
      description: "With 100 tests, hybrid should select a meaningful subset",
      tests: Array.from({ length: 100 }, (_, i) => ({
        suite: `tests/module_${i}/test.spec.ts`,
        testName: `test_${i}`,
        runs: 50,
        failures: i < 5 ? 15 : (i < 10 ? 3 : 0),
        retryPasses: i < 5 ? 5 : 0,
        isNew: i >= 98,
        avgDurationMs: 100 + i * 10,
      })),
      changedFiles: ["src/module_20/index.ts", "src/module_21/index.ts"],
      expectedMustInclude: ["tests/module_20/test.spec.ts", "tests/module_21/test.spec.ts"],
      expectedMustExclude: [],
      expectedMinCount: 10,
      expectedMaxCount: 30,
      sampleCount: 20,
      strategy: "hybrid",
    },
  ];
}

export async function runSelfEval(opts: { store: MetricStore }): Promise<SelfEvalReport> {
  const { store } = opts;
  const scenarios = getScenarios();
  const results: ScenarioResult[] = [];
  const improvements: string[] = [];

  for (const scenario of scenarios) {
    const result = await evaluateScenario(store, scenario);
    results.push(result);
    if (!result.passed) {
      for (const issue of result.issues) {
        improvements.push(`[${scenario.name}] ${issue}`);
      }
    }
  }

  const overallScore = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length)
    : 100;

  return { scenarios: results, overallScore, improvements };
}

async function evaluateScenario(store: MetricStore, scenario: Scenario): Promise<ScenarioResult> {
  // Seed the store with scenario data
  const runId = Date.now() + Math.floor(Math.random() * 1000000);
  await store.insertWorkflowRun({
    id: runId,
    repo: "test/self-eval",
    branch: "main",
    commitSha: `eval-${scenario.name}`,
    event: "local-import",
    status: "completed",
    createdAt: new Date(),
    durationMs: null,
  });

  // Create test history
  for (const test of scenario.tests) {
    const results = [];
    for (let i = 0; i < test.runs; i++) {
      let status: string;
      if (i < test.failures) {
        status = "failed";
      } else if (i < test.failures + test.retryPasses) {
        status = "flaky";
      } else {
        status = "passed";
      }
      results.push({
        workflowRunId: runId,
        suite: test.suite,
        testName: test.testName,
        status,
        durationMs: test.avgDurationMs,
        retryCount: status === "flaky" ? 1 : 0,
        errorMessage: status === "failed" ? "Test failure" : null,
        commitSha: `eval-${scenario.name}`,
        variant: null,
        createdAt: new Date(Date.now() - (test.runs - i) * 3600000),
      });
    }
    await store.insertTestResults(results);
  }

  // For quarantine scenario, quarantine the high-failure test
  if (scenario.name === "quarantine-skip") {
    await store.addQuarantine("tests/quarantined.spec.ts", "quarantined_test", "auto");
  }

  // Run sampling
  const resolver = new SimpleResolver();
  const sampled = await runSample({
    store,
    mode: scenario.strategy,
    count: scenario.sampleCount,
    resolver,
    changedFiles: scenario.changedFiles.length > 0 ? scenario.changedFiles : undefined,
    skipQuarantined: scenario.name === "quarantine-skip",
  });

  const selectedSuites = sampled.map(s => s.suite);
  const issues: string[] = [];
  let score = 100;

  // Check must-include
  for (const expected of scenario.expectedMustInclude) {
    if (!selectedSuites.includes(expected)) {
      issues.push(`Missing expected test: ${expected}`);
      score -= 20;
    }
  }

  // Check must-exclude
  for (const excluded of scenario.expectedMustExclude) {
    if (selectedSuites.includes(excluded)) {
      issues.push(`Incorrectly included excluded test: ${excluded}`);
      score -= 20;
    }
  }

  // Check count bounds
  if (selectedSuites.length < scenario.expectedMinCount) {
    issues.push(`Too few tests selected: ${selectedSuites.length} < ${scenario.expectedMinCount}`);
    score -= 15;
  }
  if (selectedSuites.length > scenario.expectedMaxCount) {
    issues.push(`Too many tests selected: ${selectedSuites.length} > ${scenario.expectedMaxCount}`);
    score -= 10;
  }

  score = Math.max(0, score);

  return {
    scenario: scenario.name,
    passed: issues.length === 0,
    selected: selectedSuites,
    issues,
    score,
  };
}

export function formatSelfEvalReport(report: SelfEvalReport): string {
  const lines: string[] = [];
  lines.push("# Flaker Self-Evaluation Report");
  lines.push("");
  lines.push(`## Overall Score: ${report.overallScore}/100`);
  lines.push("");

  for (const r of report.scenarios) {
    const icon = r.passed ? "PASS" : "FAIL";
    lines.push(`### [${icon}] ${r.scenario} (${r.score}/100)`);
    lines.push(`  Selected: ${r.selected.length} tests`);
    if (r.selected.length <= 10) {
      for (const s of r.selected) {
        lines.push(`    - ${s}`);
      }
    } else {
      for (const s of r.selected.slice(0, 5)) {
        lines.push(`    - ${s}`);
      }
      lines.push(`    ... and ${r.selected.length - 5} more`);
    }
    if (r.issues.length > 0) {
      lines.push(`  Issues:`);
      for (const issue of r.issues) {
        lines.push(`    - ${issue}`);
      }
    }
    lines.push("");
  }

  if (report.improvements.length > 0) {
    lines.push("## Suggested Improvements");
    for (const imp of report.improvements) {
      lines.push(`  - ${imp}`);
    }
  }

  return lines.join("\n");
}
