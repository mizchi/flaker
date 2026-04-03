import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { SCHEMA_DDL, FLAKY_QUERY, CO_FAILURE_QUERY } from "./schema.js";
import { createStableTestId, resolveTestIdentity } from "../identity.js";
import type {
  MetricStore,
  WorkflowRun,
  TestResult,
  FlakyScore,
  FlakyQueryOpts,
  QuarantinedTest,
  TrendEntry,
  TrueFlakyScore,
  VariantFlakyScore,
  TestSelector,
  CollectedArtifactRecord,
  SamplingRunRecord,
  SamplingRunTestRecord,
  CommitChange,
  CoFailureResult,
  CoFailureQueryOpts,
  ExportResult,
  ImportResult,
} from "./types.js";

export class DuckDBStore implements MetricStore {
  private db: DuckDBDatabase | null = null;
  private conn: DuckDBConnection | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    let duckdb: DuckDBModule;
    try {
      duckdb = await this.loadDuckDBModule();
    } catch (error) {
      throw this.buildDuckDBLoadError(error);
    }
    if (this.dbPath !== ":memory:") {
      mkdirSync(dirname(this.dbPath), { recursive: true });
    }
    this.db = await new Promise<DuckDBDatabase>((resolve, reject) => {
      try {
        const db = new duckdb.Database(this.dbPath, (err: any) => {
          if (err) reject(err);
          else resolve(db);
        });
      } catch (err) {
        reject(err);
      }
    });
    this.conn = this.db.connect();
    await this.exec(SCHEMA_DDL);
    await this.backfillLegacyQuarantineEntries();
  }

  private async loadDuckDBModule(): Promise<DuckDBModule> {
    const mod = (await import("duckdb")) as unknown as { default?: DuckDBModule } & DuckDBModule;
    return mod.default ?? mod;
  }

  private buildDuckDBLoadError(error: unknown): Error {
    return new Error(
      [
        "Failed to load DuckDB native binding.",
        "Install/rebuild dependencies and ensure the runtime can load native modules.",
        "Try: npm_config_nodedir=$(dirname $(dirname $(which node))) pnpm rebuild duckdb",
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
      ].join(" ")
    );
  }

  async close(): Promise<void> {
    if (this.db) {
      await new Promise<void>((resolve, reject) => {
        this.db!.close((err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.conn = null;
      this.db = null;
    }
  }

  async insertWorkflowRun(run: WorkflowRun): Promise<void> {
    await this.run(
      `INSERT INTO workflow_runs (id, repo, branch, commit_sha, event, status, created_at, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      [
        run.id,
        run.repo,
        run.branch,
        run.commitSha,
        run.event,
        run.status,
        run.createdAt,
        run.durationMs,
      ]
    );
  }

  async hasCollectedArtifact(record: CollectedArtifactRecord): Promise<boolean> {
    const rows = await this.all(
      `SELECT 1
       FROM collected_artifacts
       WHERE workflow_run_id = ? AND adapter_type = ? AND artifact_name = ? AND adapter_config = ?`,
      [
        record.workflowRunId,
        record.adapterType,
        record.artifactName,
        record.adapterConfig ?? "",
      ],
    );
    return rows.length > 0;
  }

  async recordCollectedArtifact(record: CollectedArtifactRecord): Promise<void> {
    await this.run(
      `INSERT INTO collected_artifacts (workflow_run_id, adapter_type, artifact_name, adapter_config, collected_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (workflow_run_id, adapter_type, artifact_name, adapter_config) DO NOTHING`,
      [
        record.workflowRunId,
        record.adapterType,
        record.artifactName,
        record.adapterConfig ?? "",
        record.collectedAt ?? new Date(),
      ],
    );
  }

  async recordSamplingRun(run: SamplingRunRecord): Promise<number> {
    const [idRow] = await this.all(
      `SELECT nextval('sampling_runs_id_seq')::BIGINT AS id`,
    );
    const id = Number(idRow.id);
    await this.run(
      `INSERT INTO sampling_runs (
         id,
         commit_sha,
         command_kind,
         strategy,
         requested_count,
         requested_percentage,
         seed,
         changed_files,
         candidate_count,
         selected_count,
         sample_ratio,
         estimated_saved_tests,
         estimated_saved_minutes,
         fallback_reason,
         duration_ms,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        run.commitSha ?? null,
        run.commandKind,
        run.strategy,
        run.requestedCount ?? null,
        run.requestedPercentage ?? null,
        run.seed ?? null,
        run.changedFiles ? JSON.stringify(run.changedFiles) : null,
        run.candidateCount,
        run.selectedCount,
        run.sampleRatio ?? null,
        run.estimatedSavedTests ?? null,
        run.estimatedSavedMinutes ?? null,
        run.fallbackReason ?? null,
        run.durationMs ?? null,
        run.createdAt ?? new Date(),
      ],
    );
    return id;
  }

  async recordSamplingRunTests(records: SamplingRunTestRecord[]): Promise<void> {
    for (const record of records) {
      await this.run(
        `INSERT INTO sampling_run_tests (
           sampling_run_id,
           ordinal,
           test_id,
           task_id,
           suite,
           test_name,
           filter_text
         )
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          record.samplingRunId,
          record.ordinal,
          record.testId ?? null,
          record.taskId ?? null,
          record.suite,
          record.testName,
          record.filter ?? null,
        ],
      );
    }
  }

  async insertTestResults(results: TestResult[]): Promise<void> {
    for (const r of results) {
      const resolved = resolveTestIdentity(r);
      await this.run(
        `INSERT INTO test_results (id, workflow_run_id, test_id, task_id, suite, test_name, filter_text, status, duration_ms, retry_count, error_message, commit_sha, variant, quarantine, created_at)
         VALUES (nextval('test_results_id_seq'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          resolved.workflowRunId,
          resolved.testId,
          resolved.taskId,
          resolved.suite,
          resolved.testName,
          resolved.filter,
          resolved.status,
          resolved.durationMs,
          resolved.retryCount,
          resolved.errorMessage,
          resolved.commitSha,
          resolved.variant ? JSON.stringify(resolved.variant) : null,
          resolved.quarantine ? JSON.stringify(resolved.quarantine) : null,
          resolved.createdAt,
        ]
      );
    }
  }

  async queryFlakyTests(opts: FlakyQueryOpts): Promise<FlakyScore[]> {
    const windowDays = opts.windowDays ?? 30;
    const rows = await this.all(FLAKY_QUERY, [windowDays.toString()]);
    return rows.map((row: any) => {
      const resolved = resolveTestIdentity({
        suite: row.suite,
        testName: row.test_name,
        taskId: row.task_id,
        filter: row.filter_text,
        variant: row.variant ? JSON.parse(row.variant) : null,
        testId: row.test_id || undefined,
      });
      return {
        testId: resolved.testId,
        suite: resolved.suite,
        testName: resolved.testName,
        taskId: resolved.taskId,
        filter: resolved.filter,
        variant: resolved.variant,
        totalRuns: row.total_runs,
        failCount: row.fail_count,
        flakyRetryCount: row.flaky_retry_count,
        flakyRate: row.flaky_rate,
        lastFlakyAt: row.last_flaky_at ? new Date(row.last_flaky_at) : null,
        firstSeenAt: new Date(row.first_seen_at),
      };
    });
  }

  async queryTestHistory(
    suite: string,
    testName: string
  ): Promise<TestResult[]> {
    const rows = await this.all(
      `SELECT * FROM test_results WHERE suite = ? AND test_name = ? ORDER BY created_at DESC`,
      [suite, testName]
    );
    return rows.map((row: any) => {
      const resolved = resolveTestIdentity({
        suite: row.suite,
        testName: row.test_name,
        taskId: row.task_id,
        filter: row.filter_text,
        variant: row.variant ? JSON.parse(row.variant) : null,
        testId: row.test_id || undefined,
      });
      return {
        id: row.id,
        workflowRunId: row.workflow_run_id,
        suite: resolved.suite,
        testName: resolved.testName,
        taskId: resolved.taskId,
        filter: resolved.filter,
        status: row.status,
        durationMs: row.duration_ms,
        retryCount: row.retry_count,
        errorMessage: row.error_message,
        commitSha: row.commit_sha,
        variant: resolved.variant,
        testId: resolved.testId,
        quarantine: row.quarantine ? JSON.parse(row.quarantine) : null,
        createdAt: new Date(row.created_at),
      };
    });
  }

  async queryTrueFlakyTests(opts?: { top?: number }): Promise<TrueFlakyScore[]> {
    let sql = `
      WITH commit_results AS (
        SELECT
          COALESCE(test_id, '') AS test_id,
          suite,
          test_name,
          commit_sha,
          COUNT(DISTINCT status) FILTER (WHERE status IN ('passed', 'failed')) AS distinct_statuses
        FROM test_results
        GROUP BY test_id, suite, test_name, commit_sha
      )
      SELECT
        test_id,
        suite,
        test_name,
        COUNT(*)::INTEGER AS commits_tested,
        COUNT(*) FILTER (WHERE distinct_statuses > 1)::INTEGER AS flaky_commits,
        ROUND(COUNT(*) FILTER (WHERE distinct_statuses > 1) * 100.0 / COUNT(*), 2)::DOUBLE AS true_flaky_rate
      FROM commit_results
      GROUP BY test_id, suite, test_name
      HAVING flaky_commits > 0
      ORDER BY true_flaky_rate DESC`;
    if (opts?.top) sql += ` LIMIT ${opts.top}`;
    const rows = await this.all(sql);
    return rows.map((r: any) => ({
      testId: r.test_id || createStableTestId({ suite: r.suite, testName: r.test_name }),
      suite: r.suite,
      testName: r.test_name,
      commitsTested: r.commits_tested,
      flakyCommits: r.flaky_commits,
      trueFlakyRate: r.true_flaky_rate,
    }));
  }

  async queryFlakyTrend(suite: string, testName: string): Promise<TrendEntry[]> {
    const rows = await this.all(
      `SELECT COALESCE(test_id, '') AS test_id,
        suite, test_name,
        DATE_TRUNC('week', created_at)::VARCHAR AS week,
        COUNT(*)::INTEGER AS runs,
        ROUND(COUNT(*) FILTER (WHERE status = 'failed') * 100.0 / COUNT(*), 2)::DOUBLE AS flaky_rate
      FROM test_results WHERE suite = ? AND test_name = ?
      GROUP BY test_id, suite, test_name, week ORDER BY week`,
      [suite, testName]
    );
    return rows.map((r: any) => ({
      testId: r.test_id || createStableTestId({ suite: r.suite, testName: r.test_name }),
      suite: r.suite, testName: r.test_name, week: r.week, runs: r.runs, flakyRate: r.flaky_rate,
    }));
  }

  async queryFlakyByVariant(opts?: { suite?: string; testName?: string; top?: number }): Promise<VariantFlakyScore[]> {
    const conditions = ["variant IS NOT NULL"];
    const params: unknown[] = [];
    if (opts?.suite) {
      conditions.push("suite = ?");
      params.push(opts.suite);
    }
    if (opts?.testName) {
      conditions.push("test_name = ?");
      params.push(opts.testName);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    let sql = `
      SELECT
        COALESCE(test_id, '') AS test_id,
        COALESCE(task_id, suite) AS task_id,
        suite,
        test_name,
        filter_text,
        variant,
        COUNT(*)::INTEGER AS total_runs,
        COUNT(*) FILTER (WHERE status = 'failed')::INTEGER AS fail_count,
        ROUND(COUNT(*) FILTER (WHERE status = 'failed') * 100.0 / COUNT(*), 2)::DOUBLE AS flaky_rate
      FROM test_results
      ${where}
      GROUP BY test_id, task_id, suite, test_name, filter_text, variant
      ORDER BY flaky_rate DESC`;
    if (opts?.top) sql += ` LIMIT ${opts.top}`;
    const rows = await this.all(sql, params);
    return rows.map((r: any) => {
      const resolved = resolveTestIdentity({
        suite: r.suite,
        testName: r.test_name,
        taskId: r.task_id,
        filter: r.filter_text,
        variant: JSON.parse(r.variant),
        testId: r.test_id || undefined,
      });
      return {
        testId: resolved.testId,
        suite: resolved.suite,
        testName: resolved.testName,
        taskId: resolved.taskId,
        filter: resolved.filter,
        variant: resolved.variant!,
        totalRuns: r.total_runs,
        failCount: r.fail_count,
        flakyRate: r.flaky_rate,
      };
    });
  }

  async raw<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.all(sql, params ?? []) as Promise<T[]>;
  }

  async addQuarantine(test: TestSelector, reason: string): Promise<void> {
    const resolved = resolveTestIdentity(test);
    await this.run(
      `INSERT INTO quarantined_test_identities (test_id, task_id, suite, test_name, filter_text, reason)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (test_id) DO UPDATE SET reason = EXCLUDED.reason`,
      [
        resolved.testId,
        resolved.taskId,
        resolved.suite,
        resolved.testName,
        resolved.filter,
        reason,
      ],
    );
  }

  async removeQuarantine(test: TestSelector): Promise<void> {
    const resolved = resolveTestIdentity(test);
    await this.run(
      `DELETE FROM quarantined_test_identities WHERE test_id = ?`,
      [resolved.testId],
    );
  }

  async queryQuarantined(): Promise<QuarantinedTest[]> {
    const rows = await this.all(
      `SELECT test_id, task_id, suite, test_name, filter_text, reason, created_at
       FROM quarantined_test_identities
       ORDER BY created_at DESC`,
    );
    return rows.map((row: any) => ({
      testId: row.test_id,
      taskId: row.task_id,
      suite: row.suite,
      testName: row.test_name,
      filter: row.filter_text,
      reason: row.reason,
      createdAt: new Date(row.created_at),
    }));
  }

  async isQuarantined(test: TestSelector): Promise<boolean> {
    const resolved = resolveTestIdentity(test);
    const rows = await this.all(
      `SELECT 1 FROM quarantined_test_identities WHERE test_id = ?`,
      [resolved.testId],
    );
    return rows.length > 0;
  }

  async insertCommitChanges(commitSha: string, changes: CommitChange[]): Promise<void> {
    for (const change of changes) {
      await this.run(
        `INSERT INTO commit_changes (commit_sha, file_path, change_type, additions, deletions)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (commit_sha, file_path) DO NOTHING`,
        [commitSha, change.filePath, change.changeType, change.additions, change.deletions],
      );
    }
  }

  async hasCommitChanges(commitSha: string): Promise<boolean> {
    const rows = await this.all(
      `SELECT 1 FROM commit_changes WHERE commit_sha = ? LIMIT 1`,
      [commitSha],
    );
    return rows.length > 0;
  }

  async queryCoFailures(opts: CoFailureQueryOpts): Promise<CoFailureResult[]> {
    const windowDays = opts.windowDays ?? 90;
    const minCoRuns = opts.minCoRuns ?? 3;
    const rows = await this.all(CO_FAILURE_QUERY, [windowDays.toString(), minCoRuns]);
    return rows.map((r: any) => ({
      filePath: r.file_path,
      testId: r.test_id,
      suite: r.suite,
      testName: r.test_name,
      coRuns: r.co_runs,
      coFailures: r.co_failures,
      coFailureRate: r.co_failure_rate,
    }));
  }

  async getCoFailureBoosts(
    changedFiles: string[],
    opts?: CoFailureQueryOpts,
  ): Promise<Map<string, number>> {
    if (changedFiles.length === 0) {
      return new Map();
    }
    const allCoFailures = await this.queryCoFailures(opts ?? {});
    const changedSet = new Set(changedFiles);
    const boosts = new Map<string, number>();
    for (const cf of allCoFailures) {
      if (!changedSet.has(cf.filePath)) continue;
      const existing = boosts.get(cf.testId) ?? 0;
      boosts.set(cf.testId, Math.max(existing, cf.coFailureRate));
    }
    return boosts;
  }

  async exportRunToParquet(workflowRunId: number, outputDir: string): Promise<ExportResult> {
    mkdirSync(outputDir, { recursive: true });

    const wrPath = join(outputDir, `workflow_run_${workflowRunId}.parquet`);
    const trPath = join(outputDir, `test_results_${workflowRunId}.parquet`);
    const ccPath = join(outputDir, `commit_changes_${workflowRunId}.parquet`);

    // Get commit_sha for this run
    const [run] = await this.all(
      `SELECT commit_sha FROM workflow_runs WHERE id = ?`,
      [workflowRunId],
    );
    if (!run) throw new Error(`Workflow run ${workflowRunId} not found`);
    const commitSha = run.commit_sha;

    // Export workflow_runs
    await this.run(
      `COPY (SELECT * FROM workflow_runs WHERE id = ${workflowRunId}) TO '${wrPath}' (FORMAT PARQUET)`,
    );

    // Export test_results for this run
    const [trCount] = await this.all(
      `SELECT COUNT(*)::INTEGER AS cnt FROM test_results WHERE workflow_run_id = ?`,
      [workflowRunId],
    );
    await this.run(
      `COPY (SELECT * FROM test_results WHERE workflow_run_id = ${workflowRunId}) TO '${trPath}' (FORMAT PARQUET)`,
    );

    // Export commit_changes for this commit
    const [ccCount] = await this.all(
      `SELECT COUNT(*)::INTEGER AS cnt FROM commit_changes WHERE commit_sha = ?`,
      [commitSha],
    );
    await this.run(
      `COPY (SELECT * FROM commit_changes WHERE commit_sha = '${commitSha}') TO '${ccPath}' (FORMAT PARQUET)`,
    );

    return {
      testResultsCount: trCount.cnt,
      commitChangesCount: ccCount.cnt,
      workflowRunPath: wrPath,
      testResultsPath: trPath,
      commitChangesPath: ccPath,
    };
  }

  async importFromParquetDir(inputDir: string): Promise<ImportResult> {
    const { readdirSync } = await import("node:fs");
    const files = readdirSync(inputDir).filter((f) => f.endsWith(".parquet"));

    // Sort: workflow_run_ first, then commit_changes_, then test_results_
    // (test_results has FK to workflow_runs)
    const priorityOrder = (name: string): number => {
      if (name.startsWith("workflow_run_")) return 0;
      if (name.startsWith("commit_changes_")) return 1;
      if (name.startsWith("test_results_")) return 2;
      return 3;
    };
    files.sort((a, b) => priorityOrder(a) - priorityOrder(b));

    let workflowRunsImported = 0;
    let testResultsImported = 0;
    let commitChangesImported = 0;

    for (const file of files) {
      const filePath = join(inputDir, file);
      if (file.startsWith("workflow_run_")) {
        const [before] = await this.all("SELECT COUNT(*)::INTEGER AS cnt FROM workflow_runs");
        await this.exec(
          `INSERT OR IGNORE INTO workflow_runs SELECT * FROM read_parquet('${filePath}')`,
        );
        const [after] = await this.all("SELECT COUNT(*)::INTEGER AS cnt FROM workflow_runs");
        workflowRunsImported += after.cnt - before.cnt;
      } else if (file.startsWith("test_results_")) {
        const [before] = await this.all("SELECT COUNT(*)::INTEGER AS cnt FROM test_results");
        await this.exec(
          `INSERT OR IGNORE INTO test_results SELECT * FROM read_parquet('${filePath}')`,
        );
        const [after] = await this.all("SELECT COUNT(*)::INTEGER AS cnt FROM test_results");
        testResultsImported += after.cnt - before.cnt;
      } else if (file.startsWith("commit_changes_")) {
        const [before] = await this.all("SELECT COUNT(*)::INTEGER AS cnt FROM commit_changes");
        await this.exec(
          `INSERT OR IGNORE INTO commit_changes SELECT * FROM read_parquet('${filePath}')`,
        );
        const [after] = await this.all("SELECT COUNT(*)::INTEGER AS cnt FROM commit_changes");
        commitChangesImported += after.cnt - before.cnt;
      }
    }

    return { workflowRunsImported, testResultsImported, commitChangesImported };
  }

  // Private helpers

  private all(sql: string, params: unknown[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const cb = (err: any, result: any) => {
        if (err) reject(err);
        else resolve(result);
      };
      this.conn!.all(sql, ...params, cb);
    });
  }

  private run(sql: string, params: unknown[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      const cb = (err: any) => {
        if (err) reject(err);
        else resolve();
      };
      this.conn!.run(sql, ...params, cb);
    });
  }

  private exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.conn!.exec(sql, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async backfillLegacyQuarantineEntries(): Promise<void> {
    const rows = await this.all(
      `SELECT suite, test_name, reason, created_at FROM quarantined_tests`,
    );
    for (const row of rows) {
      const resolved = resolveTestIdentity({
        suite: row.suite,
        testName: row.test_name,
      });
      await this.run(
        `INSERT INTO quarantined_test_identities (test_id, task_id, suite, test_name, filter_text, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (test_id) DO NOTHING`,
        [
          resolved.testId,
          resolved.taskId,
          resolved.suite,
          resolved.testName,
          resolved.filter,
          row.reason,
          row.created_at,
        ],
      );
    }
  }
}

type DuckDBModule = {
  Database: new (...args: unknown[]) => DuckDBDatabase;
};

type DuckDBDatabase = {
  connect: () => DuckDBConnection;
  close: (callback: (err: unknown) => void) => void;
};

type DuckDBConnection = {
  all: (sql: string, ...params: unknown[]) => void;
  run: (sql: string, ...params: unknown[]) => void;
  exec: (sql: string, callback: (err: unknown) => void) => void;
};
