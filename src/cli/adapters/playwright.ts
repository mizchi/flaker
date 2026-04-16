import { basename, extname } from "node:path";
import type {
  TestArtifactKind,
  TestArtifactRef,
  TestCaseResult,
  TestFailureLocation,
  TestResultAdapter,
} from "./types.js";
import { resolveTestIdentity } from "../identity.js";

interface PlaywrightResult {
  status: string;
  duration: number;
  retry: number;
  error?: { message: string };
  errors?: Array<{ message?: string; value?: string }>;
  attachments?: Array<{
    name?: string;
    path?: string;
    contentType?: string;
  }>;
}

interface PlaywrightTest {
  projectName: string;
  results: PlaywrightResult[];
  status: string;
}

interface PlaywrightSpec {
  title: string;
  file?: string;
  line?: number;
  column?: number;
  tests: PlaywrightTest[];
}

interface PlaywrightSuite {
  title: string;
  file?: string;
  suites?: PlaywrightSuite[];
  specs?: PlaywrightSpec[];
}

interface PlaywrightReport {
  suites: PlaywrightSuite[];
}

function inferArtifactKind(
  path: string,
  name?: string,
  contentType?: string,
): TestArtifactKind {
  const fileName = basename(path).toLowerCase();
  const label = `${name ?? ""} ${contentType ?? ""}`.toLowerCase();
  const ext = extname(fileName);

  if (fileName.includes("stdout") || label.includes("stdout")) return "stdout";
  if (fileName.includes("stderr") || label.includes("stderr")) return "stderr";
  if (fileName.includes("trace") || label.includes("trace")) return "trace";
  if (
    fileName.includes("screenshot")
    || label.includes("screenshot")
    || label.includes("image/")
    || [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)
  ) return "screenshot";
  if (label.includes("video") || [".mp4", ".webm", ".mov"].includes(ext)) return "video";
  if (
    fileName.includes("report")
    || fileName.includes("results")
    || label.includes("json")
    || label.includes("xml")
    || [".json", ".xml", ".html"].includes(ext)
  ) return "report";
  if ([ ".zip", ".tar", ".gz", ".tgz" ].includes(ext)) return "archive";
  if ([ ".log", ".txt" ].includes(ext)) return "log";
  return "other";
}

function collectArtifacts(results: PlaywrightResult[]): TestArtifactRef[] | null {
  const byPath = new Map<string, TestArtifactRef>();
  for (const result of results) {
    for (const attachment of result.attachments ?? []) {
      if (!attachment.path) {
        continue;
      }
      if (byPath.has(attachment.path)) {
        continue;
      }
      byPath.set(attachment.path, {
        path: attachment.path,
        fileName: basename(attachment.path),
        kind: inferArtifactKind(
          attachment.path,
          attachment.name,
          attachment.contentType,
        ),
        contentType: attachment.contentType ?? null,
      });
    }
  }
  return byPath.size > 0 ? [...byPath.values()] : null;
}

function resolveFailureLocation(
  spec: PlaywrightSpec,
  suiteFile: string,
): TestFailureLocation | null {
  const file = spec.file ?? suiteFile;
  if (!file || typeof spec.line !== "number") {
    return null;
  }
  return {
    file,
    line: spec.line,
    column: typeof spec.column === "number" ? spec.column : null,
    functionName: null,
    raw: `${file}:${spec.line}${typeof spec.column === "number" ? `:${spec.column}` : ""}`,
  };
}

function walkSuites(
  suite: PlaywrightSuite,
  currentFile: string | null,
  currentTaskId: string | null,
  out: TestCaseResult[],
): void {
  const nextFile = suite.file ?? currentFile ?? suite.title;
  const nextTaskId = currentTaskId ?? suite.title;

  if (suite.specs) {
    for (const spec of suite.specs) {
      for (const test of spec.tests) {
        const lastResult = test.results[test.results.length - 1];
        const maxRetry = Math.max(...test.results.map((r) => r.retry));

        // Detect flaky: had retries and last result passed
        const isFlaky = maxRetry > 0 && lastResult.status === "passed";

        let status: TestCaseResult["status"];
        if (isFlaky) {
          status = "flaky";
        } else if (lastResult.status === "passed") {
          status = "passed";
        } else if (lastResult.status === "skipped") {
          status = "skipped";
        } else {
          status = "failed";
        }

        // Find first failure error message
        const firstFailure = test.results.find(
          (r) => r.status === "failed" && (r.error || (r.errors?.length ?? 0) > 0),
        );
        const artifacts = collectArtifacts(test.results);
        const failureLocation = resolveFailureLocation(spec, nextFile);

        const result: TestCaseResult = resolveTestIdentity({
          suite: nextFile,
          testName: spec.title,
          taskId: nextTaskId,
          status,
          durationMs: lastResult.duration,
          retryCount: maxRetry,
          variant: { project: test.projectName },
          failureLocation,
          artifactPaths: artifacts?.map((artifact) => artifact.path) ?? null,
          artifacts,
        });

        if (firstFailure?.error?.message) {
          result.errorMessage = firstFailure.error.message;
        } else {
          const firstFailureMessage = firstFailure?.errors
            ?.map((error) => error.message ?? error.value ?? "")
            .find((message) => message.length > 0);
          if (firstFailureMessage) {
            result.errorMessage = firstFailureMessage;
          }
        }

        out.push(result);
      }
    }
  }

  if (suite.suites) {
    for (const child of suite.suites) {
      walkSuites(child, nextFile, child.title, out);
    }
  }
}

export const playwrightAdapter: TestResultAdapter = {
  name: "playwright",
  parse(input: string): TestCaseResult[] {
    const report: PlaywrightReport = JSON.parse(input);
    const results: TestCaseResult[] = [];
    for (const suite of report.suites) {
      walkSuites(suite, suite.file ?? null, suite.title, results);
    }
    return results;
  },
};
