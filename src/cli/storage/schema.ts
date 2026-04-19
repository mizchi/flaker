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
WHERE tr.created_at > CURRENT_TIMESTAMP - INTERVAL (? || ' days')
GROUP BY cc.file_path, tr.test_id, tr.suite, tr.test_name
HAVING co_runs >= ? AND co_failures > 0
ORDER BY co_failure_rate DESC
`;

export const TEST_CO_FAILURE_QUERY = `
WITH failed_results AS (
  SELECT DISTINCT
    workflow_run_id,
    COALESCE(test_id, '') AS test_id,
    COALESCE(task_id, suite) AS task_id,
    suite,
    test_name,
    filter_text
  FROM test_results
  WHERE created_at > CURRENT_TIMESTAMP - INTERVAL (? || ' days')
    AND (
      status IN ('failed', 'flaky')
      OR (retry_count > 0 AND status = 'passed')
    )
),
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
