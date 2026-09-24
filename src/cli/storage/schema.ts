import { validateTagKey } from "../workflow-filter.js";

export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS workflow_runs (
  id            BIGINT PRIMARY KEY,
  repo          VARCHAR NOT NULL,
  branch        VARCHAR,
  commit_sha    VARCHAR NOT NULL,
  event         VARCHAR,
  status        VARCHAR,
  created_at    TIMESTAMP,
  duration_ms   INTEGER
);

CREATE TABLE IF NOT EXISTS test_results (
  id              INTEGER PRIMARY KEY,
  workflow_run_id BIGINT REFERENCES workflow_runs(id),
  test_id         VARCHAR,
  task_id         VARCHAR,
  suite           VARCHAR NOT NULL,
  test_name       VARCHAR NOT NULL,
  filter_text     VARCHAR,
  status          VARCHAR NOT NULL,
  duration_ms     INTEGER,
  retry_count     INTEGER DEFAULT 0,
  error_message   VARCHAR,
  failure_location JSON,
  stdout_text     VARCHAR,
  stderr_text     VARCHAR,
  artifact_paths  JSON,
  artifacts       JSON,
  commit_sha      VARCHAR NOT NULL,
  variant         JSON,
  quarantine      JSON,
  created_at      TIMESTAMP
);

CREATE TABLE IF NOT EXISTS collected_artifacts (
  workflow_run_id BIGINT REFERENCES workflow_runs(id),
  adapter_type    VARCHAR NOT NULL,
  artifact_name   VARCHAR NOT NULL,
  adapter_config  VARCHAR NOT NULL DEFAULT '',
  artifact_id     BIGINT,
  local_archive_path VARCHAR,
  artifact_entries JSON,
  collected_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workflow_run_id, adapter_type, artifact_name, adapter_config)
);

ALTER TABLE collected_artifacts ADD COLUMN IF NOT EXISTS artifact_id BIGINT;
ALTER TABLE collected_artifacts ADD COLUMN IF NOT EXISTS local_archive_path VARCHAR;
ALTER TABLE collected_artifacts ADD COLUMN IF NOT EXISTS artifact_entries JSON;

CREATE SEQUENCE IF NOT EXISTS test_results_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS sampling_runs_id_seq START 1;

CREATE TABLE IF NOT EXISTS quarantined_tests (
  suite       VARCHAR NOT NULL,
  test_name   VARCHAR NOT NULL,
  reason      VARCHAR NOT NULL DEFAULT 'manual',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (suite, test_name)
);

ALTER TABLE test_results ADD COLUMN IF NOT EXISTS test_id VARCHAR;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS task_id VARCHAR;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS filter_text VARCHAR;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS quarantine JSON;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS failure_location JSON;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS stdout_text VARCHAR;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS stderr_text VARCHAR;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS artifact_paths JSON;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS artifacts JSON;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS title_path JSON;

CREATE TABLE IF NOT EXISTS quarantined_test_identities (
  test_id      VARCHAR PRIMARY KEY,
  task_id      VARCHAR NOT NULL,
  suite        VARCHAR NOT NULL,
  test_name    VARCHAR NOT NULL,
  filter_text  VARCHAR,
  reason       VARCHAR NOT NULL DEFAULT 'manual',
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sampling_runs (
  id                        BIGINT PRIMARY KEY,
  commit_sha                VARCHAR,
  command_kind              VARCHAR NOT NULL,
  strategy                  VARCHAR NOT NULL,
  requested_count           INTEGER,
  requested_percentage      DOUBLE,
  seed                      BIGINT,
  changed_files             JSON,
  candidate_count           INTEGER NOT NULL,
  selected_count            INTEGER NOT NULL,
  sample_ratio              DOUBLE,
  estimated_saved_tests     INTEGER,
  estimated_saved_minutes   DOUBLE,
  fallback_reason           VARCHAR,
  duration_ms               INTEGER,
  created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sampling_run_tests (
  sampling_run_id BIGINT REFERENCES sampling_runs(id),
  ordinal         INTEGER NOT NULL,
  test_id         VARCHAR,
  task_id         VARCHAR,
  suite           VARCHAR NOT NULL,
  test_name       VARCHAR NOT NULL,
  filter_text     VARCHAR,
  is_holdout      BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (sampling_run_id, ordinal)
);

ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'ci';
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS workflow_name VARCHAR;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS lane VARCHAR;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS tags JSON;

CREATE TABLE IF NOT EXISTS commit_changes (
  commit_sha  VARCHAR NOT NULL,
  file_path   VARCHAR NOT NULL,
  change_type VARCHAR,
  additions   INTEGER DEFAULT 0,
  deletions   INTEGER DEFAULT 0,
  PRIMARY KEY (commit_sha, file_path)
);

CREATE TABLE IF NOT EXISTS test_coverage (
  test_id    VARCHAR NOT NULL,
  suite      VARCHAR NOT NULL,
  test_name  VARCHAR NOT NULL,
  edge       VARCHAR NOT NULL,
  PRIMARY KEY (test_id, edge)
);

CREATE TABLE IF NOT EXISTS flaker_dataset_config (
  id                      INTEGER PRIMARY KEY,
  flaky_window_days       INTEGER NOT NULL,
  flaky_threshold_ratio   DOUBLE NOT NULL,
  co_failure_window_days  INTEGER NOT NULL,
  full_run_ratio          DOUBLE NOT NULL
);
INSERT INTO flaker_dataset_config VALUES (1, 14, 0.02, 90, 0.95) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS flaker_lane_config (
  lane     VARCHAR PRIMARY KEY,
  is_full  BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS selector_runs (
  selector_run_id   VARCHAR PRIMARY KEY,
  selector          VARCHAR NOT NULL,
  selector_version  VARCHAR,
  head_sha          VARCHAR,
  base_sha          VARCHAR,
  context_digest    VARCHAR,
  source            VARCHAR NOT NULL DEFAULT 'real',
  gate              JSON,
  created_at        TIMESTAMP NOT NULL,
  imported_at       TIMESTAMP DEFAULT (now() AT TIME ZONE 'UTC')  -- naive UTC, not session-local
);

CREATE TABLE IF NOT EXISTS selector_run_tests (
  selector_run_id  VARCHAR NOT NULL,
  ordinal          INTEGER NOT NULL,
  test_key         VARCHAR,
  file             VARCHAR NOT NULL,
  title_path       JSON NOT NULL,
  project          VARCHAR,
  runner_file      VARCHAR,
  score            DOUBLE,
  confidence       DOUBLE,
  reason           VARCHAR NOT NULL,
  selected         BOOLEAN NOT NULL,
  PRIMARY KEY (selector_run_id, ordinal)
);

CREATE TABLE IF NOT EXISTS gate_calibrations (
  selector       VARCHAR NOT NULL,
  calibrated_at  TIMESTAMP NOT NULL,
  cutoff         DOUBLE NOT NULL,
  unsure_below   DOUBLE NOT NULL,
  unsure_margin  DOUBLE NOT NULL,
  records        INTEGER NOT NULL,
  real_failures  INTEGER NOT NULL,
  recall_lb95    DOUBLE,
  decision       VARCHAR NOT NULL,
  rationale      VARCHAR NOT NULL,
  PRIMARY KEY (selector, calibrated_at)
);
`;

export const CO_FAILURE_QUERY = `
SELECT
  cc.file_path,
  COALESCE(tr.test_id, '') AS test_id,
  tr.suite,
  tr.test_name,
  COUNT(*)::INTEGER AS co_runs,
  COUNT(*) FILTER (WHERE tr.status IN ('failed', 'flaky')
    OR (tr.retry_count > 0 AND tr.status = 'passed'))::INTEGER AS co_failures,
  ROUND(
    COUNT(*) FILTER (WHERE tr.status IN ('failed', 'flaky')
      OR (tr.retry_count > 0 AND tr.status = 'passed'))
    * 100.0 / COUNT(*), 2
  )::DOUBLE AS co_failure_rate
FROM commit_changes cc
JOIN test_results tr ON cc.commit_sha = tr.commit_sha
WHERE tr.created_at > ?::TIMESTAMP
GROUP BY cc.file_path, tr.test_id, tr.suite, tr.test_name
HAVING co_runs >= ? AND co_failures > 0
ORDER BY co_failure_rate DESC
`;

const TEST_CO_FAILURE_QUERY_TAIL = `
fail_counts AS (
  SELECT
    test_id,
    COUNT(*)::INTEGER AS fail_runs
  FROM failed_results
  GROUP BY test_id
),
pair_counts AS (
  SELECT
    a.test_id AS test_a_id,
    a.task_id AS test_a_task_id,
    a.suite AS test_a_suite,
    a.test_name AS test_a_name,
    a.filter_text AS test_a_filter,
    b.test_id AS test_b_id,
    b.task_id AS test_b_task_id,
    b.suite AS test_b_suite,
    b.test_name AS test_b_name,
    b.filter_text AS test_b_filter,
    COUNT(*)::INTEGER AS co_fail_runs
  FROM failed_results a
  JOIN failed_results b
    ON a.workflow_run_id = b.workflow_run_id
   AND a.test_id < b.test_id
  GROUP BY
    a.test_id,
    a.task_id,
    a.suite,
    a.test_name,
    a.filter_text,
    b.test_id,
    b.task_id,
    b.suite,
    b.test_name,
    b.filter_text
)
SELECT
  pairs.test_a_id,
  pairs.test_a_task_id,
  pairs.test_a_suite,
  pairs.test_a_name,
  pairs.test_a_filter,
  counts_a.fail_runs AS test_a_fail_runs,
  pairs.test_b_id,
  pairs.test_b_task_id,
  pairs.test_b_suite,
  pairs.test_b_name,
  pairs.test_b_filter,
  counts_b.fail_runs AS test_b_fail_runs,
  pairs.co_fail_runs,
  ROUND(
    pairs.co_fail_runs * 1.0 / LEAST(counts_a.fail_runs, counts_b.fail_runs),
    4
  )::DOUBLE AS co_fail_rate
FROM pair_counts pairs
JOIN fail_counts counts_a ON counts_a.test_id = pairs.test_a_id
JOIN fail_counts counts_b ON counts_b.test_id = pairs.test_b_id
WHERE pairs.co_fail_runs >= ?
  AND (
    pairs.co_fail_runs * 1.0 / LEAST(counts_a.fail_runs, counts_b.fail_runs)
  ) >= ?
ORDER BY
  co_fail_rate DESC,
  pairs.co_fail_runs DESC,
  pairs.test_a_suite ASC,
  pairs.test_b_suite ASC
`;

/**
 * Build the TEST_CO_FAILURE query, optionally narrowing the `failed_results`
 * CTE to a workflow lane / name / tag set so callers can avoid same-batch bias.
 *
 * Returns `{ sql, extraParams }`. Callers prepend `[cutoffLiteral, ...extraParams,
 * minCoFailures, minCoRate]` to keep the original positional ordering.
 *
 * `tags` is rendered inline because DuckDB's parameterised `json_extract` is
 * awkward — keys are validated against `TAG_KEY_PATTERN` (alnum + `_-./`) via
 * `validateTagKey` so the inline path is safe; values stay parameterised.
 */
export function buildTestCoFailureQuery(filter?: {
  workflow?: { name?: string; lane?: string; tags?: Record<string, string> };
}): { sql: string; extraParams: unknown[] } {
  const wf = filter?.workflow;
  const hasWorkflowFilter = !!wf && (wf.name != null || wf.lane != null || (wf.tags && Object.keys(wf.tags).length > 0));
  const extraParams: unknown[] = [];
  let workflowJoin = "";
  let workflowWhere = "";
  if (hasWorkflowFilter) {
    workflowJoin = "JOIN workflow_runs wr ON wr.id = tr.workflow_run_id";
    const conds: string[] = [];
    if (wf!.name != null) {
      conds.push("wr.workflow_name = ?");
      extraParams.push(wf!.name);
    }
    if (wf!.lane != null) {
      conds.push("wr.lane = ?");
      extraParams.push(wf!.lane);
    }
    if (wf!.tags) {
      for (const [k, v] of Object.entries(wf!.tags)) {
        validateTagKey(k);
        conds.push(`json_extract_string(wr.tags, '$.${k}') = ?`);
        extraParams.push(v);
      }
    }
    workflowWhere = "AND " + conds.join(" AND ");
  }
  return {
    sql: `
WITH failed_results AS (
  SELECT DISTINCT
    tr.workflow_run_id,
    COALESCE(tr.test_id, '') AS test_id,
    COALESCE(tr.task_id, tr.suite) AS task_id,
    tr.suite,
    tr.test_name,
    tr.filter_text
  FROM test_results tr
  ${workflowJoin}
  WHERE tr.created_at > ?::TIMESTAMP
    AND (
      tr.status IN ('failed', 'flaky')
      OR (tr.retry_count > 0 AND tr.status = 'passed')
    )
    ${workflowWhere}
),
${TEST_CO_FAILURE_QUERY_TAIL}`,
    extraParams,
  };
}

export const FLAKY_QUERY = `
WITH recent AS (
  SELECT * FROM test_results
  WHERE created_at > ?::TIMESTAMP
)
SELECT
  COALESCE(test_id, '') AS test_id,
  COALESCE(task_id, suite) AS task_id,
  suite,
  test_name,
  filter_text,
  variant,
  COUNT(*)::INTEGER AS total_runs,
  COUNT(*) FILTER (WHERE status = 'failed')::INTEGER AS fail_count,
  COUNT(*) FILTER (WHERE status = 'flaky' OR (retry_count > 0 AND status = 'passed'))::INTEGER AS flaky_retry_count,
  ROUND((COUNT(*) FILTER (WHERE status IN ('failed', 'flaky') OR (retry_count > 0 AND status = 'passed')) ) * 100.0 / COUNT(*), 2)::DOUBLE AS flaky_rate,
  MAX(created_at) FILTER (WHERE status IN ('failed', 'flaky')) AS last_flaky_at,
  MIN(created_at) AS first_seen_at
FROM recent
GROUP BY test_id, task_id, suite, test_name, filter_text, variant
HAVING flaky_rate > 0
ORDER BY flaky_rate DESC
`;
