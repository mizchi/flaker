import { resolveTestIdentity } from "../identity.js";
import type { TestCaseResult, TestResultAdapter } from "./types.js";

interface BenchViewportResult {
  width: number;
  height: number;
  visualDiffDetected: boolean;
  visualDiffRatio: number;
  a11yDiffDetected: boolean;
  a11yChangeCount: number;
  computedStyleDiffCount: number;
  hoverDiffDetected: boolean;
  paintTreeDiffCount: number;
}

interface BenchTrial {
  fixture?: string;
  backend: string;
  fallbackUsed?: boolean;
  backendResolvedBy?: string;
  selector: string;
  property: string;
  value: string;
  category: string;
  selectorType: string;
  isInteractive: boolean;
  mediaCondition: string | null;
  viewports?: BenchViewportResult[];
  detected: boolean;
  undetectedReason: string | null;
}

interface BenchReport {
  meta?: {
    fixture?: string;
  };
  trials: BenchTrial[];
}

function resolveFixture(report: BenchReport, trial: BenchTrial): string {
  return trial.fixture ?? report.meta?.fixture ?? "unknown";
}

function buildSuite(fixture: string): string {
  return `fixtures/css-challenge/${fixture}.html`;
}

function buildTaskId(fixture: string): string {
  return `css-bench/${fixture}`;
}

function buildTestName(trial: BenchTrial): string {
  return `${trial.selector} { ${trial.property}: ${trial.value} }`;
}

function buildVariant(trial: BenchTrial): Record<string, string> {
  return {
    backend: trial.backend,
    category: trial.category,
    selectorType: trial.selectorType,
    interactive: String(trial.isInteractive),
    fallbackUsed: String(Boolean(trial.fallbackUsed)),
    resolvedBy: trial.backendResolvedBy ?? trial.backend,
  };
}

function summarizeSignals(trial: BenchTrial): string | null {
  if (!trial.viewports || trial.viewports.length === 0) {
    return null;
  }

  const signalCount = trial.viewports.reduce(
    (acc, viewport) => ({
      visual: acc.visual + (viewport.visualDiffDetected ? 1 : 0),
      computed: acc.computed + viewport.computedStyleDiffCount,
      hover: acc.hover + (viewport.hoverDiffDetected ? 1 : 0),
      paint: acc.paint + viewport.paintTreeDiffCount,
    }),
    { visual: 0, computed: 0, hover: 0, paint: 0 },
  );

  return `signals visual=${signalCount.visual} computed=${signalCount.computed} hover=${signalCount.hover} paint=${signalCount.paint}`;
}

function buildErrorMessage(trial: BenchTrial): string | undefined {
  const pieces = [
    trial.undetectedReason ?? "undetected",
    `backend=${trial.backend}`,
    trial.mediaCondition ? `media=${trial.mediaCondition}` : null,
    summarizeSignals(trial),
  ].filter((piece): piece is string => Boolean(piece));

  return pieces.length > 0 ? pieces.join(" | ") : undefined;
}

export const vrtBenchAdapter: TestResultAdapter = {
  name: "vrt-bench",
  parse(input: string): TestCaseResult[] {
    const report = JSON.parse(input) as BenchReport;

    return report.trials.map((trial) => {
      const fixture = resolveFixture(report, trial);
      const status: TestCaseResult["status"] = trial.detected
        ? "passed"
        : "failed";
      const result: TestCaseResult = resolveTestIdentity({
        suite: buildSuite(fixture),
        testName: buildTestName(trial),
        taskId: buildTaskId(fixture),
        filter: trial.mediaCondition ?? undefined,
        status,
        durationMs: 0,
        retryCount: 0,
        variant: buildVariant(trial),
      });

      if (status === "failed") {
        result.errorMessage = buildErrorMessage(trial);
      }
      return result;
    });
  },
};
