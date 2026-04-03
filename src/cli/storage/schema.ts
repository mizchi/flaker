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
  collected_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workflow_run_id, adapter_type, artifact_name, adapter_config)
);

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
  PRIMARY KEY (sampling_run_id, ordinal)
);

CREATE TABLE IF NOT EXISTS commit_changes (
  commit_sha  VARCHAR NOT NULL,
  file_path   VARCHAR NOT NULL,
  change_type VARCHAR,
  additions   INTEGER DEFAULT 0,
  deletions   INTEGER DEFAULT 0,
  PRIMARY KEY (commit_sha, file_path)
);
`;

export const FLAKY_QUERY = `
WITH recent AS (
  SELECT * FROM test_results
  WHERE created_at > CURRENT_TIMESTAMP - INTERVAL (? || ' days')
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
