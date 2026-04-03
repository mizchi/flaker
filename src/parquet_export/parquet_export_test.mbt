test "write_test_results_parquet produces valid bytes" {
  let rows = [
    TestResultRow::{
      workflow_run_id: 1L,
      test_id: Some("test-id-1"),
      task_id: Some("task-1"),
      suite: "tests/login.spec.ts",
      test_name: "login works",
      status: "passed",
      duration_ms: 150,
      retry_count: 0,
      commit_sha: "abc123",
      created_at_ms: 1712100000000L,
    },
    TestResultRow::{
      workflow_run_id: 1L,
      test_id: None,
      task_id: None,
      suite: "tests/signup.spec.ts",
      test_name: "signup works",
      status: "failed",
      duration_ms: 200,
      retry_count: 1,
      commit_sha: "abc123",
      created_at_ms: 1712100000000L,
    },
  ]
  let bytes = write_test_results_parquet!(rows)
  // Parquet files start with magic bytes "PAR1"
  assert_true!(bytes.length() > 4)
  assert_eq!(bytes[0], b'P')
  assert_eq!(bytes[1], b'A')
  assert_eq!(bytes[2], b'R')
  assert_eq!(bytes[3], b'1')
}

test "write_commit_changes_parquet produces valid bytes" {
  let rows = [
    CommitChangeRow::{
      commit_sha: "abc123",
      file_path: "src/foo.ts",
      change_type: Some("modified"),
      additions: 10,
      deletions: 5,
    },
  ]
  let bytes = write_commit_changes_parquet!(rows)
  assert_true!(bytes.length() > 4)
  assert_eq!(bytes[0], b'P')
}

test "write_workflow_runs_parquet produces valid bytes" {
  let rows = [
    WorkflowRunRow::{
      id: 42L,
      repo: "test/repo",
      branch: Some("main"),
      commit_sha: "abc123",
      event: Some("push"),
      status: Some("completed"),
      created_at_ms: 1712100000000L,
      duration_ms: 60000,
    },
  ]
  let bytes = write_workflow_runs_parquet!(rows)
  assert_true!(bytes.length() > 4)
  assert_eq!(bytes[0], b'P')
}

test "round-trip: write and read test_results" {
  let rows = [
    TestResultRow::{
      workflow_run_id: 1L,
      test_id: Some("tid"),
      task_id: Some("task"),
      suite: "tests/a.spec.ts",
      test_name: "test a",
      status: "passed",
      duration_ms: 100,
      retry_count: 0,
      commit_sha: "sha1",
      created_at_ms: 1712100000000L,
    },
  ]
  let bytes = write_test_results_parquet!(rows)
  let file = @parquet.read_bytes!(bytes)
  assert_eq!(file.row_count(), 1)
  let row = file.rows()[0]
  assert_eq!(row[3], @parquet.Value::String("tests/a.spec.ts"))
  assert_eq!(row[5], @parquet.Value::String("passed"))
}
