import type { QuarantineManifestEntry } from "../quarantine-manifest.js";

export interface TestCaseResult {
  suite: string;
  testName: string;
  taskId?: string | null;
  filter?: string | null;
  status: "passed" | "failed" | "skipped" | "flaky";
  durationMs: number;
  retryCount: number;
  errorMessage?: string;
  variant?: Record<string, string> | null;
  testId?: string;
  quarantine?: QuarantineManifestEntry | null;
}

export interface TestResultAdapter {
  name: string;
  parse(input: string): TestCaseResult[];
}
