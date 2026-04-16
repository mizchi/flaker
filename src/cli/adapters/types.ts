import type { QuarantineManifestEntry } from "../quarantine-manifest.js";

export type TestArtifactKind =
  | "stdout"
  | "stderr"
  | "trace"
  | "screenshot"
  | "video"
  | "report"
  | "archive"
  | "log"
  | "other";

export interface TestArtifactRef {
  path: string;
  fileName?: string | null;
  kind: TestArtifactKind;
  contentType?: string | null;
}

export interface TestFailureLocation {
  file: string;
  line: number;
  column: number | null;
  functionName: string | null;
  raw: string;
}

export interface TestCaseResult {
  suite: string;
  testName: string;
  taskId?: string | null;
  filter?: string | null;
  status: "passed" | "failed" | "skipped" | "flaky";
  durationMs: number;
  retryCount: number;
  errorMessage?: string;
  failureLocation?: TestFailureLocation | null;
  stdout?: string;
  stderr?: string;
  artifactPaths?: string[] | null;
  artifacts?: TestArtifactRef[] | null;
  variant?: Record<string, string> | null;
  testId?: string;
  quarantine?: QuarantineManifestEntry | null;
}

export interface TestResultAdapter {
  name: string;
  parse(input: string): TestCaseResult[];
}
