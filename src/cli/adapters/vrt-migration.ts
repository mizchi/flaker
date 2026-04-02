import { resolveTestIdentity } from "../identity.js";
import type { TestCaseResult, TestResultAdapter } from "./types.js";

interface MigrationViewport {
  width: number;
  height: number;
  label: string;
}

interface MigrationResult {
  variant?: string;
  variantFile?: string;
  viewport: string;
  diffPixels: number;
  approved?: boolean;
  approvalReasons?: string[];
  dominantCategory?: string;
  categorySummary?: string;
  paintTreeSummary?: string;
}

interface MigrationReport {
  dir?: string;
  variants: string[];
  viewports: MigrationViewport[];
  results: MigrationResult[];
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function basenameWithoutHtml(value: string): string {
  const normalized = normalizePath(value).split("/").at(-1) ?? value;
  return normalized.endsWith(".html")
    ? normalized.slice(0, -".html".length)
    : normalized;
}

function inferTaskId(reportDir?: string): string {
  if (!reportDir) {
    return "migration/unknown";
  }

  const segments = normalizePath(reportDir).split("/").filter(Boolean);
  const migrationIndex = segments.lastIndexOf("migration");
  if (migrationIndex >= 0 && segments[migrationIndex + 1]) {
    return `migration/${segments[migrationIndex + 1]}`;
  }

  return `migration/${segments.at(-1) ?? "unknown"}`;
}

function resolveVariantFile(
  report: MigrationReport,
  result: MigrationResult,
): string {
  if (result.variantFile) {
    return normalizePath(result.variantFile);
  }

  const exactMatch = report.variants.find((variantFile) =>
    variantFile === result.variant || basenameWithoutHtml(variantFile) === result.variant,
  );

  if (exactMatch) {
    return normalizePath(exactMatch);
  }

  return normalizePath(result.variant ? `${result.variant}.html` : "unknown.html");
}

function resolveSuite(reportDir: string | undefined, variantFile: string): string {
  const normalizedVariant = normalizePath(variantFile);
  if (!reportDir) {
    return normalizedVariant;
  }
  if (normalizedVariant.includes("/")) {
    return normalizedVariant;
  }
  return normalizePath(`${normalizePath(reportDir)}/${normalizedVariant}`);
}

function buildVariant(viewport: MigrationViewport): Record<string, string> {
  return {
    backend: "chromium",
    viewport: viewport.label,
    width: String(viewport.width),
    height: String(viewport.height),
  };
}

function buildErrorMessage(result: MigrationResult): string | undefined {
  const pieces = [
    `${result.diffPixels}px diff`,
    result.dominantCategory && result.dominantCategory !== "none"
      ? result.dominantCategory
      : null,
    result.categorySummary ?? null,
    result.paintTreeSummary ?? null,
  ].filter((entry): entry is string => Boolean(entry));

  return pieces.length > 0 ? pieces.join(" | ") : undefined;
}

export const vrtMigrationAdapter: TestResultAdapter = {
  name: "vrt-migration",
  parse(input: string): TestCaseResult[] {
    const report = JSON.parse(input) as MigrationReport;
    const taskId = inferTaskId(report.dir);

    return report.results.map((result) => {
      const viewport = report.viewports.find((entry) => entry.label === result.viewport);
      if (!viewport) {
        throw new Error(`Unknown viewport in migration report: ${result.viewport}`);
      }

      const suite = resolveSuite(report.dir, resolveVariantFile(report, result));
      const status: TestCaseResult["status"] =
        result.approved || result.diffPixels === 0 ? "passed" : "failed";
      const errorMessage = status === "failed"
        ? buildErrorMessage(result)
        : result.approved
          ? (result.approvalReasons ?? []).join("; ") || "approved"
          : undefined;

      const testCaseResult: TestCaseResult = resolveTestIdentity({
        suite,
        testName: `viewport:${result.viewport}`,
        taskId,
        status,
        durationMs: 0,
        retryCount: 0,
        variant: buildVariant(viewport),
      });

      if (errorMessage) {
        testCaseResult.errorMessage = errorMessage;
      }
      return testCaseResult;
    });
  },
};
