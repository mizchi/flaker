import type { RunnerAdapter, TestId } from "../../runners/types.js";
import type { TestCaseResult } from "../../adapters/types.js";

export interface DiagnoseOpts {
  runner: RunnerAdapter;
  suite: string;
  testName: string;
  runs: number;
  mutations: string[];
  cwd?: string;
}

export interface MutationResult {
  name: string;
  runs: number;
  failures: number;
  failureRate: number;
  results: Array<{
    exitCode: number;
    durationMs: number;
    status: string;
  }>;
}

export interface DiagnoseReport {
  target: { suite: string; testName: string };
  baseline: MutationResult;
  mutations: MutationResult[];
  diagnosis: string[];
}

const ALL_MUTATIONS = ["order", "repeat", "env", "isolate"];

async function runNTimes(
  runner: RunnerAdapter,
  tests: TestId[],
  n: number,
  cwd?: string,
  env?: Record<string, string>,
  shuffle?: boolean,
): Promise<MutationResult["results"]> {
  const results: MutationResult["results"] = [];

  for (let i = 0; i < n; i++) {
    let runTests = [...tests];
    if (shuffle && runTests.length > 1) {
      // Fisher-Yates shuffle
      for (let j = runTests.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [runTests[j], runTests[k]] = [runTests[k], runTests[j]];
      }
    }

    const result = await runner.execute(runTests, { cwd, env });
    const testResult = result.results.find(
      (r) => r.suite === tests[0]?.suite && r.testName === tests[0]?.testName,
    );
    results.push({
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      status: testResult?.status ?? (result.exitCode === 0 ? "passed" : "failed"),
    });
  }

  return results;
}

function toMutationResult(name: string, results: MutationResult["results"]): MutationResult {
  const failures = results.filter(
    (r) => r.status === "failed" || r.exitCode !== 0,
  ).length;
  return {
    name,
    runs: results.length,
    failures,
    failureRate: results.length > 0 ? Math.round((failures / results.length) * 10000) / 100 : 0,
    results,
  };
}

/**
 * Generate random environment variable mutations.
 */
function randomEnvMutations(): Record<string, string> {
  const mutations: Record<string, string> = {};
  const candidates = [
    { key: "NODE_OPTIONS", values: ["--max-old-space-size=256", "--max-old-space-size=512", ""] },
    { key: "TZ", values: ["UTC", "America/New_York", "Asia/Tokyo"] },
    { key: "LANG", values: ["en_US.UTF-8", "C", "ja_JP.UTF-8"] },
    { key: "CI", values: ["true", "false"] },
  ];

  for (const candidate of candidates) {
    if (Math.random() > 0.5) {
      mutations[candidate.key] =
        candidate.values[Math.floor(Math.random() * candidate.values.length)];
    }
  }

  return mutations;
}

export async function runDiagnose(opts: DiagnoseOpts): Promise<DiagnoseReport> {
  const target: TestId = {
    suite: opts.suite,
    testName: opts.testName,
  };

  const mutationsToRun =
    opts.mutations.length === 0 || opts.mutations.includes("all")
      ? ALL_MUTATIONS
      : opts.mutations;

  // Baseline: run normally N times
  const baselineResults = await runNTimes(opts.runner, [target], opts.runs, opts.cwd);
  const baseline = toMutationResult("baseline", baselineResults);

  const mutations: MutationResult[] = [];

  // Order shuffle mutation
  if (mutationsToRun.includes("order")) {
    // List all tests, then run target with shuffled full suite
    let allTests: TestId[];
    try {
      allTests = await opts.runner.listTests({ cwd: opts.cwd });
    } catch {
      allTests = [target];
    }
    const orderResults: MutationResult["results"] = [];
    for (let i = 0; i < opts.runs; i++) {
      // Shuffle full test list
      const shuffled = [...allTests];
      for (let j = shuffled.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
      }
      const result = await opts.runner.execute(shuffled, { cwd: opts.cwd });
      const testResult = result.results.find(
        (r) => r.suite === target.suite && r.testName === target.testName,
      );
      orderResults.push({
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        status: testResult?.status ?? (result.exitCode === 0 ? "passed" : "failed"),
      });
    }
    mutations.push(toMutationResult("order-shuffle", orderResults));
  }

  // Repeat mutation: run same test multiple times to detect non-determinism
  if (mutationsToRun.includes("repeat")) {
    const repeatResults = await runNTimes(opts.runner, [target], opts.runs * 2, opts.cwd);
    mutations.push(toMutationResult("repeat", repeatResults));
  }

  // Environment mutation
  if (mutationsToRun.includes("env")) {
    const envResults: MutationResult["results"] = [];
    for (let i = 0; i < opts.runs; i++) {
      const env = randomEnvMutations();
      const result = await opts.runner.execute([target], { cwd: opts.cwd, env });
      const testResult = result.results.find(
        (r) => r.suite === target.suite && r.testName === target.testName,
      );
      envResults.push({
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        status: testResult?.status ?? (result.exitCode === 0 ? "passed" : "failed"),
      });
    }
    mutations.push(toMutationResult("env-mutate", envResults));
  }

  // Isolate mutation: run only this test
  if (mutationsToRun.includes("isolate")) {
    const isolateResults = await runNTimes(opts.runner, [target], opts.runs, opts.cwd);
    mutations.push(toMutationResult("isolate", isolateResults));
  }

  // Analyze results
  const diagnosis: string[] = [];

  for (const mut of mutations) {
    const diff = mut.failureRate - baseline.failureRate;
    if (Math.abs(diff) < 5) {
      diagnosis.push(`${mut.name}: baseline と同程度 (${mut.failureRate}% vs ${baseline.failureRate}%)`);
    } else if (diff > 0) {
      // More failures in this mutation
      if (mut.name === "order-shuffle") {
        diagnosis.push(
          `🔀 順序依存の疑い: order-shuffle で失敗率が上昇 (${baseline.failureRate}% → ${mut.failureRate}%)`,
        );
      } else if (mut.name === "env-mutate") {
        diagnosis.push(
          `🌍 環境依存の疑い: env-mutate で失敗率が上昇 (${baseline.failureRate}% → ${mut.failureRate}%)`,
        );
      } else if (mut.name === "repeat") {
        diagnosis.push(
          `🎲 非決定性の疑い: repeat で失敗率が上昇 (${baseline.failureRate}% → ${mut.failureRate}%)`,
        );
      } else {
        diagnosis.push(
          `⚠️ ${mut.name}: 失敗率が上昇 (${baseline.failureRate}% → ${mut.failureRate}%)`,
        );
      }
    } else {
      if (mut.name === "isolate" && baseline.failureRate > 0) {
        diagnosis.push(
          `✅ isolate で失敗率が低下 (${baseline.failureRate}% → ${mut.failureRate}%): 他のテストとの依存が原因の可能性`,
        );
      } else {
        diagnosis.push(
          `${mut.name}: 失敗率が低下 (${baseline.failureRate}% → ${mut.failureRate}%)`,
        );
      }
    }
  }

  if (diagnosis.length === 0) {
    diagnosis.push("全ミューテーションで baseline と差異なし。原因の特定に至りませんでした。");
  }

  return { target, baseline, mutations, diagnosis };
}

export function formatDiagnoseReport(report: DiagnoseReport): string {
  const lines = [
    "# Diagnose Report",
    "",
    `  Target: ${report.target.suite} > ${report.target.testName}`,
    "",
    "## Baseline",
    `  Runs: ${report.baseline.runs}  Failures: ${report.baseline.failures}  Rate: ${report.baseline.failureRate}%`,
    "",
    "## Mutations",
  ];

  for (const mut of report.mutations) {
    lines.push(`  ${mut.name}: ${mut.runs} runs, ${mut.failures} failures (${mut.failureRate}%)`);
  }

  lines.push("", "## Diagnosis");
  for (const d of report.diagnosis) {
    lines.push(`  ${d}`);
  }

  return lines.join("\n");
}
