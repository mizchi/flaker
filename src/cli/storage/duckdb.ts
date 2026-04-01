import duckdb from "duckdb";
import { SCHEMA_DDL, FLAKY_QUERY } from "./schema.js";
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
} from "./types.js";

export class DuckDBStore implements MetricStore {
  private db: duckdb.Database | null = null;
  private conn: duckdb.Connection | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    this.db = await new Promise<duckdb.Database>((resolve, reject) => {
      const db = new duckdb.Database(this.dbPath, (err: any) => {
        if (err) reject(err);
        else resolve(db);
      });
    });
    this.conn = this.db.connect();
    await this.exec(SCHEMA_DDL);
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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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

  async insertTestResults(results: TestResult[]): Promise<void> {
    for (const r of results) {
      await this.run(
        `INSERT INTO test_results (id, workflow_run_id, suite, test_name, status, duration_ms, retry_count, error_message, commit_sha, variant, created_at)
         VALUES (nextval('test_results_id_seq'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.workflowRunId,
          r.suite,
          r.testName,
          r.status,
          r.durationMs,
          r.retryCount,
          r.errorMessage,
          r.commitSha,
          r.variant ? JSON.stringify(r.variant) : null,
          r.createdAt,
        ]
      );
    }
  }

  async queryFlakyTests(opts: FlakyQueryOpts): Promise<FlakyScore[]> {
    const windowDays = opts.windowDays ?? 30;
    const rows = await this.all(FLAKY_QUERY, [windowDays.toString()]);
    return rows.map((row: any) => ({
      suite: row.suite,
      testName: row.test_name,
      variant: row.variant ? JSON.parse(row.variant) : null,
      totalRuns: row.total_runs,
      failCount: row.fail_count,
      flakyRetryCount: row.flaky_retry_count,
      flakyRate: row.flaky_rate,
      lastFlakyAt: row.last_flaky_at ? new Date(row.last_flaky_at) : null,
      firstSeenAt: new Date(row.first_seen_at),
    }));
  }

  async queryTestHistory(
    suite: string,
    testName: string
  ): Promise<TestResult[]> {
    const rows = await this.all(
      `SELECT * FROM test_results WHERE suite = ? AND test_name = ? ORDER BY created_at DESC`,
      [suite, testName]
    );
    return rows.map((row: any) => ({
      id: row.id,
      workflowRunId: row.workflow_run_id,
      suite: row.suite,
      testName: row.test_name,
      status: row.status,
      durationMs: row.duration_ms,
      retryCount: row.retry_count,
      errorMessage: row.error_message,
      commitSha: row.commit_sha,
      variant: row.variant ? JSON.parse(row.variant) : null,
      createdAt: new Date(row.created_at),
    }));
  }

  async queryTrueFlakyTests(opts?: { top?: number }): Promise<TrueFlakyScore[]> {
    let sql = `
      WITH commit_results AS (
        SELECT
          suite, test_name, commit_sha,
          COUNT(DISTINCT status) FILTER (WHERE status IN ('passed', 'failed')) AS distinct_statuses
        FROM test_results
        GROUP BY suite, test_name, commit_sha
      )
      SELECT
        suite, test_name,
        COUNT(*)::INTEGER AS commits_tested,
        COUNT(*) FILTER (WHERE distinct_statuses > 1)::INTEGER AS flaky_commits,
        ROUND(COUNT(*) FILTER (WHERE distinct_statuses > 1) * 100.0 / COUNT(*), 2)::DOUBLE AS true_flaky_rate
      FROM commit_results
      GROUP BY suite, test_name
      HAVING flaky_commits > 0
      ORDER BY true_flaky_rate DESC`;
    if (opts?.top) sql += ` LIMIT ${opts.top}`;
    const rows = await this.all(sql);
    return rows.map((r: any) => ({
      suite: r.suite,
      testName: r.test_name,
      commitsTested: r.commits_tested,
      flakyCommits: r.flaky_commits,
      trueFlakyRate: r.true_flaky_rate,
    }));
  }

  async queryFlakyTrend(suite: string, testName: string): Promise<TrendEntry[]> {
    const rows = await this.all(
      `SELECT suite, test_name,
        DATE_TRUNC('week', created_at)::VARCHAR AS week,
        COUNT(*)::INTEGER AS runs,
        ROUND(COUNT(*) FILTER (WHERE status = 'failed') * 100.0 / COUNT(*), 2)::DOUBLE AS flaky_rate
      FROM test_results WHERE suite = ? AND test_name = ?
      GROUP BY suite, test_name, week ORDER BY week`,
      [suite, testName]
    );
    return rows.map((r: any) => ({
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
        suite,
        test_name,
        variant,
        COUNT(*)::INTEGER AS total_runs,
        COUNT(*) FILTER (WHERE status = 'failed')::INTEGER AS fail_count,
        ROUND(COUNT(*) FILTER (WHERE status = 'failed') * 100.0 / COUNT(*), 2)::DOUBLE AS flaky_rate
      FROM test_results
      ${where}
      GROUP BY suite, test_name, variant
      ORDER BY flaky_rate DESC`;
    if (opts?.top) sql += ` LIMIT ${opts.top}`;
    const rows = await this.all(sql, params);
    return rows.map((r: any) => ({
      suite: r.suite,
      testName: r.test_name,
      variant: JSON.parse(r.variant),
      totalRuns: r.total_runs,
      failCount: r.fail_count,
      flakyRate: r.flaky_rate,
    }));
  }

  async raw<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.all(sql, params ?? []) as Promise<T[]>;
  }

  async addQuarantine(
    suite: string,
    testName: string,
    reason: string,
  ): Promise<void> {
    await this.run(
      `INSERT INTO quarantined_tests (suite, test_name, reason)
       VALUES (?, ?, ?)
       ON CONFLICT (suite, test_name) DO UPDATE SET reason = EXCLUDED.reason`,
      [suite, testName, reason],
    );
  }

  async removeQuarantine(suite: string, testName: string): Promise<void> {
    await this.run(
      `DELETE FROM quarantined_tests WHERE suite = ? AND test_name = ?`,
      [suite, testName],
    );
  }

  async queryQuarantined(): Promise<QuarantinedTest[]> {
    const rows = await this.all(
      `SELECT suite, test_name, reason, created_at FROM quarantined_tests ORDER BY created_at DESC`,
    );
    return rows.map((row: any) => ({
      suite: row.suite,
      testName: row.test_name,
      reason: row.reason,
      createdAt: new Date(row.created_at),
    }));
  }

  async isQuarantined(suite: string, testName: string): Promise<boolean> {
    const rows = await this.all(
      `SELECT 1 FROM quarantined_tests WHERE suite = ? AND test_name = ?`,
      [suite, testName],
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
}
