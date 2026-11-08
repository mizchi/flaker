///|
#warnings("-deprecated-deprecated_syntax")
#derive(Show, FromJson, ToJson)
pub(all) struct TestResultRow {
  workflow_run_id : Int64
  test_id : String?
  task_id : String?
  suite : String
  test_name : String
  status : String
  duration_ms : Int32
  retry_count : Int32
  commit_sha : String
  created_at_ms : Int64
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Show, FromJson, ToJson)
pub(all) struct CommitChangeRow {
  commit_sha : String
  file_path : String
  change_type : String?
  additions : Int32
  deletions : Int32
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Show, FromJson, ToJson)
pub(all) struct WorkflowRunRow {
  id : Int64
  repo : String
  branch : String?
  commit_sha : String
  event : String?
  status : String?
  created_at_ms : Int64
  duration_ms : Int32
}
