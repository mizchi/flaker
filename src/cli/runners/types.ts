import type { TestCaseResult } from "../adapters/types.js";

export interface TestId {
  suite: string;
  testName: string;
  taskId?: string | null;
  filter?: string | null;
  variant?: Record<string, string> | null;
  testId?: string;
}

export interface RunnerCapabilities {
  nativeParallel: boolean;
  maxBatchSize?: number;
}

export interface ExecuteOpts {
  cwd?: string;
  timeout?: number;
  retries?: number;
  env?: Record<string, string>;
  workers?: number;
}

export interface ExecuteResult {
  exitCode: number;
  results: TestCaseResult[];
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface RunnerAdapter {
  name: string;
  capabilities: RunnerCapabilities;
  execute(tests: TestId[], opts?: ExecuteOpts): Promise<ExecuteResult>;
  listTests(opts?: ExecuteOpts): Promise<TestId[]>;
}
