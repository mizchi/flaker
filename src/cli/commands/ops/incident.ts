import type { ConfirmResult } from "../debug/confirm.js";
import type { DiagnoseReport } from "../debug/diagnose.js";
import type { RetryTestResult } from "../debug/retry.js";

export interface OpsIncidentRetrySummary {
  runId: number;
  totalFailedTests: number;
  reproducedCount: number;
  unreproducedCount: number;
  results: RetryTestResult[];
}

export interface OpsIncidentConfirmSummary {
  runner: "remote" | "local";
  repeat: number;
  failures: number;
  verdict: ConfirmResult["verdict"];
  message: string;
}

export interface OpsIncidentDiagnoseSummary {
  baselineFailureRate: number;
  mutationCount: number;
  diagnosis: string[];
}

export interface OpsIncidentReport {
  schemaVersion: 1;
  generatedAt: string;
  scope: {
    runId?: number;
    target?: {
      suite: string;
      testName: string;
    };
  };
  retry?: OpsIncidentRetrySummary;
  confirm?: OpsIncidentConfirmSummary;
  diagnose?: OpsIncidentDiagnoseSummary;
  actionItems: string[];
}

function summarizeRetry(input: {
  runId: number;
  results: RetryTestResult[];
}): OpsIncidentRetrySummary {
  const reproducedCount = input.results.filter((result) => result.reproduced).length;
  return {
    runId: input.runId,
    totalFailedTests: input.results.length,
    reproducedCount,
    unreproducedCount: input.results.length - reproducedCount,
    results: input.results,
  };
}

function summarizeConfirm(result: ConfirmResult): OpsIncidentConfirmSummary {
  return {
    runner: result.runner,
    repeat: result.repeat,
    failures: result.failures,
    verdict: result.verdict,
    message: result.message,
  };
}

function summarizeDiagnose(report: DiagnoseReport): OpsIncidentDiagnoseSummary {
  return {
    baselineFailureRate: report.baseline.failureRate,
    mutationCount: report.mutations.length,
    diagnosis: report.diagnosis,
  };
}

function buildActionItems(report: {
  retry?: OpsIncidentRetrySummary;
  confirm?: OpsIncidentConfirmSummary;
  diagnose?: OpsIncidentDiagnoseSummary;
}): string[] {
  const items: string[] = [];

  if (report.retry) {
    if (report.retry.reproducedCount > 0) {
      items.push(
        `Investigate ${report.retry.reproducedCount} locally reproduced CI failure(s).`,
      );
    }
    if (report.retry.unreproducedCount > 0) {
      items.push(
        `Re-check ${report.retry.unreproducedCount} unreproduced CI failure(s) as flaky or CI-specific issues.`,
      );
    }
  }

  if (report.confirm?.verdict === "flaky") {
    items.push("Quarantine or de-gate the target test until it stabilizes.");
  } else if (report.confirm?.verdict === "broken") {
    items.push("Treat the target as a regression and start commit-level investigation.");
  } else if (report.confirm?.verdict === "transient") {
    items.push("Keep the target under observation; the failure was not reproducible.");
  }

  if (report.diagnose && report.diagnose.diagnosis.length > 0) {
    items.push(`Review diagnosis hints: ${report.diagnose.diagnosis[0]}`);
  }

  if (items.length === 0) {
    items.push("No immediate incident action required.");
  }

  return items;
}

export async function runOpsIncident(input: {
  now?: Date;
  runId?: number;
  suite?: string;
  testName?: string;
  repeat?: number;
  confirmRunner?: "remote" | "local";
  diagnoseRuns?: number;
  retry?: (runId: number) => Promise<{ runId: number; results: RetryTestResult[] }>;
  confirm?: (params: {
    suite: string;
    testName: string;
    repeat: number;
    runner: "remote" | "local";
  }) => Promise<ConfirmResult>;
  diagnose?: (params: {
    suite: string;
    testName: string;
    runs: number;
  }) => Promise<DiagnoseReport>;
}): Promise<OpsIncidentReport> {
  const now = input.now ?? new Date();
  const confirmRunner = input.confirmRunner ?? "local";
  const repeat = input.repeat ?? 5;
  const diagnoseRuns = input.diagnoseRuns ?? 3;

  const retry = input.runId != null && input.retry
    ? summarizeRetry(await input.retry(input.runId))
    : undefined;

  const target = input.suite && input.testName
    ? {
      suite: input.suite,
      testName: input.testName,
    }
    : undefined;

  const confirm = target && input.confirm
    ? summarizeConfirm(
      await input.confirm({
        ...target,
        repeat,
        runner: confirmRunner,
      }),
    )
    : undefined;

  const diagnose = target && input.diagnose
    ? summarizeDiagnose(
      await input.diagnose({
        ...target,
        runs: diagnoseRuns,
      }),
    )
    : undefined;

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    scope: {
      runId: input.runId,
      target,
    },
    retry,
    confirm,
    diagnose,
    actionItems: buildActionItems({
      retry,
      confirm,
      diagnose,
    }),
  };
}

export function formatOpsIncidentReport(report: OpsIncidentReport): string {
  const lines = [
    "# Ops Incident",
    "",
  ];

  if (report.scope.runId != null) {
    lines.push(`Run: ${report.scope.runId}`);
  }
  if (report.scope.target) {
    lines.push(`Target: ${report.scope.target.suite} > ${report.scope.target.testName}`);
  }

  if (report.retry) {
    lines.push(
      "",
      "## Retry",
      `  total failed tests: ${report.retry.totalFailedTests}`,
      `  reproduced:        ${report.retry.reproducedCount}`,
      `  not reproduced:    ${report.retry.unreproducedCount}`,
    );
  }

  if (report.confirm) {
    lines.push(
      "",
      "## Confirm",
      `  runner:            ${report.confirm.runner}`,
      `  repeat:            ${report.confirm.repeat}`,
      `  failures:          ${report.confirm.failures}`,
      `  verdict:           ${report.confirm.verdict}`,
    );
  }

  if (report.diagnose) {
    lines.push(
      "",
      "## Diagnosis",
      `  baseline failure:  ${report.diagnose.baselineFailureRate}%`,
      `  mutations:         ${report.diagnose.mutationCount}`,
    );
    for (const diagnosis of report.diagnose.diagnosis) {
      lines.push(`  - ${diagnosis}`);
    }
  }

  lines.push("", "## Action items");
  for (const item of report.actionItems) {
    lines.push(`- ${item}`);
  }

  return lines.join("\n");
}
