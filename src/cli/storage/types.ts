import type { TestIdentityFields } from "../identity.js";
import type { QuarantineManifestEntry } from "../quarantine-manifest.js";
import type {
  TestArtifactRef,
  TestFailureLocation,
} from "../adapters/types.js";

export interface WorkflowRun {
  id: number;
  repo: string;
  branch: string | null;
  commitSha: string;
  event: string | null;
  source?: "ci" | "local";
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
  failureLocation?: TestFailureLocation | null;
  stdout?: string | null;
  stderr?: string | null;
  artifactPaths?: string[] | null;
  artifacts?: TestArtifactRef[] | null;
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
  /** Reference time for the window cutoff. Defaults to the wall clock; set for deterministic queries in tests or multi-timezone contexts. */
  now?: Date;
}

export interface TestSelector extends TestIdentityFields {
  suite: string;
  testName: string;
}

export interface CollectedArtifactRecord {
  workflowRunId: number;
  adapterType: string;
  artifactName: string;
  adapterConfig?: string | null;
  artifactId?: number | null;
  localArchivePath?: string | null;
  artifactEntries?: string[] | null;
  collectedAt?: Date;
}

export interface SamplingRunRecord {
  id?: number;
  commitSha?: string | null;
  commandKind: "sample" | "run";
  strategy: string;
  requestedCount?: number | null;
  requestedPercentage?: number | null;
  seed?: number | null;
  changedFiles?: string[] | null;
  candidateCount: number;
  selectedCount: number;
  sampleRatio?: number | null;
  estimatedSavedTests?: number | null;
  estimatedSavedMinutes?: number | null;
  fallbackReason?: string | null;
  durationMs?: number | null;
  createdAt?: Date;
}

export interface SamplingRunTestRecord {
  samplingRunId: number;
  ordinal: number;
  suite: string;
  testName: string;
  taskId?: string | null;
  filter?: string | null;
  testId?: string | null;
  isHoldout?: boolean;
}

export interface CommitChange {
  filePath: string;
  changeType: string;
  additions: number;
  deletions: number;
}

export interface CoFailureResult {
  filePath: string;
  testId: string;
  suite: string;
  testName: string;
  coRuns: number;
  coFailures: number;
  coFailureRate: number;
}

export interface CoFailureQueryOpts {
  windowDays?: number;
  minCoRuns?: number;
}

export interface TestCoFailurePair {
  testAId: string;
  testATaskId: string;
  testASuite: string;
  testATestName: string;
  testAFilter: string | null;
  testAFailRuns: number;
  testBId: string;
  testBTaskId: string;
  testBSuite: string;
  testBTestName: string;
  testBFilter: string | null;
  testBFailRuns: number;
  coFailRuns: number;
  coFailRate: number;
}

export interface TestCoFailureQueryOpts {
  windowDays?: number;
  minCoFailures?: number;
  minCoRate?: number;
}

export interface ExportResult {
  testResultsCount: number;
  commitChangesCount: number;
  collectedArtifactsCount: number;
  samplingRunsCount: number;
  samplingRunTestsCount: number;
  workflowRunPath: string;
  testResultsPath: string;
  commitChangesPath: string;
  collectedArtifactsPath: string;
  samplingRunsPath: string;
  samplingRunTestsPath: string;
}

export interface ImportResult {
  workflowRunsImported: number;
  testResultsImported: number;
  commitChangesImported: number;
  collectedArtifactsImported: number;
  samplingRunsImported: number;
  samplingRunTestsImported: number;
}

export interface MetricStore {
  initialize(): Promise<void>;
  close(): Promise<void>;
  insertWorkflowRun(run: WorkflowRun): Promise<void>;
  hasCollectedArtifact(record: CollectedArtifactRecord): Promise<boolean>;
  recordCollectedArtifact(record: CollectedArtifactRecord): Promise<void>;
  insertTestResults(results: TestResult[]): Promise<void>;
  queryFlakyTests(opts: FlakyQueryOpts): Promise<FlakyScore[]>;
  queryTestHistory(suite: string, testName: string): Promise<TestResult[]>;
  queryFlakyTrend(suite: string, testName: string): Promise<TrendEntry[]>;
  queryTrueFlakyTests(opts?: { top?: number }): Promise<TrueFlakyScore[]>;
  queryFlakyByVariant(opts?: { suite?: string; testName?: string; top?: number }): Promise<VariantFlakyScore[]>;
  raw<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  recordSamplingRun(run: SamplingRunRecord): Promise<number>;
  recordSamplingRunTests(records: SamplingRunTestRecord[]): Promise<void>;
  addQuarantine(test: TestSelector, reason: string): Promise<void>;
  removeQuarantine(test: TestSelector): Promise<void>;
  queryQuarantined(): Promise<QuarantinedTest[]>;
  isQuarantined(test: TestSelector): Promise<boolean>;
  insertCommitChanges(commitSha: string, changes: CommitChange[]): Promise<void>;
  hasCommitChanges(commitSha: string): Promise<boolean>;
  queryCoFailures(opts: CoFailureQueryOpts): Promise<CoFailureResult[]>;
  getCoFailureBoosts(changedFiles: string[], opts?: CoFailureQueryOpts): Promise<Map<string, number>>;
  queryTestCoFailures(opts?: TestCoFailureQueryOpts): Promise<TestCoFailurePair[]>;
  exportRunToParquet(workflowRunId: number, outputDir: string): Promise<ExportResult>;
  importFromParquetDir(inputDir: string): Promise<ImportResult>;
}
