import duckdb from "duckdb";
import { SCHEMA_DDL, FLAKY_QUERY } from "./schema.js";
import type {
  MetricStore,
  WorkflowRun,
  TestResult,
  FlakyScore,
  FlakyQueryOpts,
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

  async raw<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.all(sql, params ?? []) as Promise<T[]>;
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
