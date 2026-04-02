import type { TestIdentityFields } from "../identity.js";
import type { QuarantineManifestEntry } from "../quarantine-manifest.js";

export interface WorkflowRun {
  id: number;
  repo: string;
  branch: string | null;
  commitSha: string;
  event: string | null;
  status: string | null;
  createdAt: Date;
  durationMs: number | null;
}

export interface TestResult {
  id?: number;
  workflowRunId: number;
  suite: string;
  testName: string;
  taskId?: string | null;
  filter?: string | null;
  status: string;
  durationMs: number | null;
  retryCount: number;
  errorMessage: string | null;
  commitSha: string;
  variant: Record<string, string> | null;
  testId?: string;
  quarantine?: QuarantineManifestEntry | null;
  createdAt: Date;
}

export interface FlakyScore {
  testId: string;
  suite: string;
  testName: string;
  taskId: string;
  filter: string | null;
  variant: Record<string, string> | null;
  totalRuns: number;
  failCount: number;
  flakyRetryCount: number;
  flakyRate: number;
  lastFlakyAt: Date | null;
  firstSeenAt: Date;
}

export interface QuarantinedTest {
  testId: string;
  suite: string;
  testName: string;
  taskId: string;
  filter: string | null;
  reason: string;
  createdAt: Date;
}

export interface TrendEntry {
  testId: string;
  suite: string;
  testName: string;
  week: string;
  runs: number;
  flakyRate: number;
}

export interface TrueFlakyScore {
  testId: string;
  suite: string;
  testName: string;
  commitsTested: number;
  flakyCommits: number;
  trueFlakyRate: number;
}

export interface VariantFlakyScore {
  testId: string;
  suite: string;
  testName: string;
  taskId: string;
  filter: string | null;
  variant: Record<string, string>;
  totalRuns: number;
  failCount: number;
  flakyRate: number;
}

export interface FlakyQueryOpts {
  top?: number;
  suite?: string;
  testName?: string;
  windowDays?: number;
}

export interface TestSelector extends TestIdentityFields {
  suite: string;
  testName: string;
}

export interface MetricStore {
  initialize(): Promise<void>;
  close(): Promise<void>;
  insertWorkflowRun(run: WorkflowRun): Promise<void>;
  insertTestResults(results: TestResult[]): Promise<void>;
  queryFlakyTests(opts: FlakyQueryOpts): Promise<FlakyScore[]>;
  queryTestHistory(suite: string, testName: string): Promise<TestResult[]>;
  queryFlakyTrend(suite: string, testName: string): Promise<TrendEntry[]>;
  queryTrueFlakyTests(opts?: { top?: number }): Promise<TrueFlakyScore[]>;
  queryFlakyByVariant(opts?: { suite?: string; testName?: string; top?: number }): Promise<VariantFlakyScore[]>;
  raw<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  addQuarantine(test: TestSelector, reason: string): Promise<void>;
  removeQuarantine(test: TestSelector): Promise<void>;
  queryQuarantined(): Promise<QuarantinedTest[]>;
  isQuarantined(test: TestSelector): Promise<boolean>;
}
