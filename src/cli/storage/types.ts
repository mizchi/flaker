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
  status: string;
  durationMs: number | null;
  retryCount: number;
  errorMessage: string | null;
  commitSha: string;
  variant: Record<string, string> | null;
  createdAt: Date;
}

export interface FlakyScore {
  suite: string;
  testName: string;
  variant: Record<string, string> | null;
  totalRuns: number;
  failCount: number;
  flakyRetryCount: number;
  flakyRate: number;
  lastFlakyAt: Date | null;
  firstSeenAt: Date;
}

export interface QuarantinedTest {
  suite: string;
  testName: string;
  reason: string;
  createdAt: Date;
}

export interface TrendEntry {
  suite: string;
  testName: string;
  week: string;
  runs: number;
  flakyRate: number;
}

export interface TrueFlakyScore {
  suite: string;
  testName: string;
  commitsTested: number;
  flakyCommits: number;
  trueFlakyRate: number;
}

export interface VariantFlakyScore {
  suite: string;
  testName: string;
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
  addQuarantine(suite: string, testName: string, reason: string): Promise<void>;
  removeQuarantine(suite: string, testName: string): Promise<void>;
  queryQuarantined(): Promise<QuarantinedTest[]>;
  isQuarantined(suite: string, testName: string): Promise<boolean>;
}
