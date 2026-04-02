import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_DDL, FLAKY_QUERY } from "./schema.js";
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
