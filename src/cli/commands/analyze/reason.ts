import type { MetricStore, FlakyScore, TrueFlakyScore, TestResult } from "../../storage/types.js";

export interface TestClassification {
  suite: string;
  testName: string;
  classification: "true-flaky" | "regression" | "environment-dependent" | "intermittent";
  confidence: number;
  evidence: string[];
  recommendation: "quarantine" | "investigate" | "fix-urgent" | "monitor" | "ignore";
  priority: "critical" | "high" | "medium" | "low";
}

export interface Pattern {
  type: "suite-instability" | "time-correlation" | "branch-correlation" | "new-test-risk";
  description: string;
  affectedTests: string[];
  severity: "high" | "medium" | "low";
}

export interface RiskPrediction {
  suite: string;
  testName: string;
  riskScore: number;
  reason: string;
}

export interface ReasoningReport {
  classifications: TestClassification[];
  patterns: Pattern[];
  riskPredictions: RiskPrediction[];
  summary: {
    totalAnalyzed: number;
    trueFlakyCount: number;
    regressionCount: number;
    quarantineRecommended: number;
    urgentFixes: number;
  };
}

export async function runReason(opts: { store: MetricStore; windowDays?: number }): Promise<ReasoningReport> {
  const { store } = opts;
  const windowDays = opts.windowDays ?? 30;

  const flakyTests = await store.queryFlakyTests({ windowDays });
  const trueFlakyTests = await store.queryTrueFlakyTests();

  const trueFlakyMap = new Map<string, TrueFlakyScore>();
  for (const t of trueFlakyTests) {
    trueFlakyMap.set(`${t.suite}\0${t.testName}`, t);
  }

  const classifications = await classifyTests(store, flakyTests, trueFlakyMap);
  const patterns = await detectPatterns(store, flakyTests);
  const riskPredictions = await predictRisks(store, windowDays);

  return {
    classifications,
    patterns,
    riskPredictions,
    summary: {
      totalAnalyzed: classifications.length,
      trueFlakyCount: classifications.filter(c => c.classification === "true-flaky").length,
      regressionCount: classifications.filter(c => c.classification === "regression").length,
      quarantineRecommended: classifications.filter(c => c.recommendation === "quarantine").length,
      urgentFixes: classifications.filter(c => c.recommendation === "fix-urgent").length,
    },
  };
}

async function classifyTests(
  store: MetricStore,
  flakyTests: FlakyScore[],
  trueFlakyMap: Map<string, TrueFlakyScore>,
): Promise<TestClassification[]> {
  const results: TestClassification[] = [];

  for (const test of flakyTests) {
    const key = `${test.suite}\0${test.testName}`;
    const evidence: string[] = [];
    let classification: TestClassification["classification"];
    let confidence: number;
    let recommendation: TestClassification["recommendation"];
    let priority: TestClassification["priority"];

    const trueFlaky = trueFlakyMap.get(key);

    const history = await store.queryTestHistory(test.suite, test.testName);

    const recentResults = history.slice(0, 20);
    const failureRate = test.flakyRate;
    const hasRetryPasses = test.flakyRetryCount > 0;

    const oldResults = history.slice(20);
    const oldFailRate = oldResults.length > 0
      ? oldResults.filter((r: TestResult) => r.status === "failed" || r.status === "flaky").length / oldResults.length * 100
      : 0;
    const isNewlyFlaky = oldFailRate < 5 && failureRate > 20;

    const commitFailMap = new Map<string, { fails: number; total: number }>();
    for (const r of recentResults) {
      const entry = commitFailMap.get(r.commitSha) ?? { fails: 0, total: 0 };
      entry.total++;
      if (r.status === "failed" || r.status === "flaky") entry.fails++;
      commitFailMap.set(r.commitSha, entry);
    }
    const commitSpecific = [...commitFailMap.values()].some(
      v => v.fails === v.total && v.total >= 2,
    );

    if (trueFlaky && trueFlaky.trueFlakyRate > 30) {
      classification = "true-flaky";
      confidence = Math.min(trueFlaky.trueFlakyRate / 100, 0.95);
      evidence.push(`Same commit produces pass/fail in ${trueFlaky.trueFlakyRate.toFixed(0)}% of commits`);
      recommendation = failureRate > 50 ? "quarantine" : "investigate";
      priority = failureRate > 50 ? "high" : "medium";
    } else if (isNewlyFlaky && commitSpecific) {
      classification = "regression";
      confidence = 0.8;
      evidence.push(`Failures started recently (old rate: ${oldFailRate.toFixed(0)}%, current: ${failureRate.toFixed(0)}%)`);
      evidence.push("Failures correlate with specific commits");
      recommendation = "fix-urgent";
      priority = "critical";
    } else if (hasRetryPasses) {
      classification = "intermittent";
      confidence = 0.7;
      evidence.push(`Passes on retry (${test.flakyRetryCount} times)`);
      recommendation = failureRate > 30 ? "quarantine" : "monitor";
      priority = failureRate > 30 ? "high" : "low";
    } else {
      classification = "environment-dependent";
      confidence = 0.5;
      evidence.push(`Failure rate: ${failureRate.toFixed(0)}%, no clear pattern`);
      recommendation = "investigate";
      priority = "medium";
    }

    results.push({
      suite: test.suite,
      testName: test.testName,
      classification,
      confidence,
      evidence,
      recommendation,
      priority,
    });
  }

  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  results.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  return results;
}

async function detectPatterns(
  store: MetricStore,
  flakyTests: FlakyScore[],
): Promise<Pattern[]> {
  const patterns: Pattern[] = [];

  // Suite-level instability
  const suiteMap = new Map<string, FlakyScore[]>();
  for (const t of flakyTests) {
    const list = suiteMap.get(t.suite) ?? [];
    list.push(t);
    suiteMap.set(t.suite, list);
  }
  for (const [suite, tests] of suiteMap) {
    if (tests.length >= 3) {
      patterns.push({
        type: "suite-instability",
        description: `Suite "${suite}" has ${tests.length} flaky tests — may indicate shared fixture or setup issue`,
        affectedTests: tests.map(t => t.testName),
        severity: tests.length >= 5 ? "high" : "medium",
      });
    }
  }

  // New test risk
  try {
    const newTestRows = await store.raw<{ suite: string; test_name: string; total: number; fails: number }>(`
      SELECT suite, test_name, COUNT(*)::INTEGER as total,
        COUNT(*) FILTER (WHERE status IN ('failed', 'flaky'))::INTEGER as fails
      FROM test_results
      WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
      GROUP BY suite, test_name
      HAVING COUNT(*) <= 5 AND COUNT(*) FILTER (WHERE status IN ('failed', 'flaky')) > 0
    `);
    if (newTestRows.length > 0) {
      patterns.push({
        type: "new-test-risk",
        description: `${newTestRows.length} recently added test(s) already showing failures`,
        affectedTests: newTestRows.map(r => `${r.suite} > ${r.test_name}`),
        severity: "medium",
      });
    }
  } catch {
    // If the query fails (e.g., schema differences), skip this pattern
  }

  return patterns;
}

async function predictRisks(store: MetricStore, windowDays: number): Promise<RiskPrediction[]> {
  try {
    const rows = await store.raw<{
      suite: string; test_name: string;
      total: number; recent_fails: number; avg_duration: number; duration_variance: number;
    }>(`
      WITH test_stats AS (
        SELECT
          suite, test_name,
          COUNT(*)::INTEGER as total,
          COUNT(*) FILTER (WHERE status IN ('failed', 'flaky')
            AND created_at > CURRENT_TIMESTAMP - INTERVAL '7 days')::INTEGER as recent_fails,
          AVG(duration_ms)::DOUBLE as avg_duration,
          STDDEV(duration_ms)::DOUBLE as duration_variance
        FROM test_results
        WHERE created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(windowDays)} || ' days')
        GROUP BY suite, test_name
        HAVING COUNT(*) >= 5
          AND COUNT(*) FILTER (WHERE status IN ('failed', 'flaky')) * 100.0 / COUNT(*) < 10
      )
      SELECT * FROM test_stats
      WHERE recent_fails > 0 OR (duration_variance IS NOT NULL AND duration_variance > avg_duration * 0.5)
      ORDER BY recent_fails DESC, duration_variance DESC
      LIMIT 10
    `);

    return rows.map(r => {
      let riskScore = 0;
      const reasons: string[] = [];

      if (r.recent_fails > 0) {
        riskScore += 40 + r.recent_fails * 10;
        reasons.push(`${r.recent_fails} recent failure(s) in last 7 days`);
      }
      if (r.duration_variance != null && r.avg_duration != null && r.duration_variance > r.avg_duration * 0.5) {
        riskScore += 20;
        reasons.push(`High duration variance (stddev ${r.duration_variance?.toFixed(0)}ms vs avg ${r.avg_duration?.toFixed(0)}ms)`);
      }

      return {
        suite: r.suite,
        testName: r.test_name,
        riskScore: Math.min(riskScore, 100),
        reason: reasons.join("; "),
      };
    });
  } catch {
    return [];
  }
}

export function formatReasoningReport(report: ReasoningReport): string {
  const lines: string[] = [];

  lines.push("# Flaker Reasoning Report");
  lines.push("");
  lines.push("## Summary");
  lines.push(`  Analyzed: ${report.summary.totalAnalyzed} flaky tests`);
  lines.push(`  True flaky: ${report.summary.trueFlakyCount}`);
  lines.push(`  Regressions: ${report.summary.regressionCount}`);
  lines.push(`  Quarantine recommended: ${report.summary.quarantineRecommended}`);
  lines.push(`  Urgent fixes: ${report.summary.urgentFixes}`);
  lines.push("");

  if (report.classifications.length > 0) {
    lines.push("## Classifications");
    for (const c of report.classifications) {
      const icon = { "fix-urgent": "!!!", quarantine: "XXX", investigate: "???", monitor: "...", ignore: "---" }[c.recommendation];
      lines.push(`  [${icon}] ${c.suite} > ${c.testName}`);
      lines.push(`        ${c.classification} (${(c.confidence * 100).toFixed(0)}% confidence) -> ${c.recommendation} [${c.priority}]`);
      for (const e of c.evidence) {
        lines.push(`        - ${e}`);
      }
    }
    lines.push("");
  }

  if (report.patterns.length > 0) {
    lines.push("## Patterns Detected");
    for (const p of report.patterns) {
      lines.push(`  [${p.severity}] ${p.type}: ${p.description}`);
    }
    lines.push("");
  }

  if (report.riskPredictions.length > 0) {
    lines.push("## At-Risk Tests (early warning)");
    for (const r of report.riskPredictions) {
      lines.push(`  [risk: ${r.riskScore}] ${r.suite} > ${r.testName}`);
      lines.push(`        ${r.reason}`);
    }
  }

  if (report.classifications.length === 0 && report.patterns.length === 0) {
    lines.push("No issues found. Test suite looks healthy!");
  }

  return lines.join("\n");
}
