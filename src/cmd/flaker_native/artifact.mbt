///|
/// A parsed test result.
struct TestResult {
  suite : String
  test_name : String
  status : String
  duration_ms : Int32
  error_message : String
}

///|
/// Download artifact and import test results for a workflow run.
pub async fn process_run_artifact(
  client : @github_client.GitHubClient,
  db : @duckdb.Connection,
  config : FlakerConfig,
  run : @github_actions.WorkflowRun,
) -> Int32 {
  let artifacts = @github_actions.list_artifacts(
    client,
    config.owner,
    config.name,
    run.id,
  )
  for artifact in artifacts.artifacts {
    if artifact.name == config.artifact_name && !artifact.expired {
      let zip_bytes = @github_actions.download_artifact(
        client,
        config.owner,
        config.name,
        artifact.id,
      )
      let entries = unzip(zip_bytes)
      let mut count = 0
      for entry in entries {
        if entry.name.has_suffix(".json") {
          let text = bytes_to_string(entry.data)
          let results = parse_vitest_json_text(text)
          if results.length() > 0 {
            insert_test_results_batch(db, results, run)
            count = count + results.length()
          }
        }
      }
      return count
    }
  }
  0
}

///|
fn parse_vitest_json_text(text : String) -> Array[TestResult] {
  let json = @json.parse(text) catch { _ => return [] }
  parse_vitest_json(json)
}

///|
fn parse_vitest_json(json : Json) -> Array[TestResult] {
  let results : Array[TestResult] = []
  guard json is Json::Object(root) else { return results }
  guard root.get("testResults") is Some(Json::Array(test_files)) else {
    return results
  }
  for file_json in test_files {
    guard file_json is Json::Object(file_obj) else { continue }
    let file_name = match file_obj.get("name") {
      Some(Json::String(s)) => s
      _ => continue
    }
    guard file_obj.get("assertionResults") is Some(Json::Array(assertions)) else {
      continue
    }
    for assertion_json in assertions {
      guard assertion_json is Json::Object(a) else { continue }
      let full_name = match a.get("fullName") {
        Some(Json::String(s)) => s
        _ => continue
      }
      let status_str = match a.get("status") {
        Some(Json::String(s)) => s
        _ => continue
      }
      if status_str == "pending" || status_str == "todo" {
        continue
      }
      let duration = match a.get("duration") {
        Some(Json::Number(n, ..)) => n.to_int()
        _ => 0
      }
      let error_msg = match a.get("failureMessages") {
        Some(Json::Array(msgs)) if msgs.length() > 0 =>
          match msgs[0] {
            Json::String(s) => s
            _ => ""
          }
        _ => ""
      }
      let parts = full_name.split(" > ")
      let parts_arr : Array[String] = []
      for p in parts {
        parts_arr.push(p.to_owned())
      }
      let test_name = if parts_arr.length() > 0 {
        parts_arr[parts_arr.length() - 1]
      } else {
        full_name
      }
      let suite = if parts_arr.length() > 1 {
        let buf = StringBuilder()
        for i = 0; i < parts_arr.length() - 1; i = i + 1 {
          if i > 0 {
            buf.write_string(" > ")
          }
          buf.write_string(parts_arr[i])
        }
        buf.to_string()
      } else {
        file_name
      }
      results.push({
        suite,
        test_name,
        status: if status_str == "passed" {
          "passed"
        } else {
          "failed"
        },
        duration_ms: duration,
        error_message: error_msg,
      })
    }
  }
  results
}

///|
/// Insert test results in batches of 50 rows.
fn insert_test_results_batch(
  db : @duckdb.Connection,
  results : Array[TestResult],
  run : @github_actions.WorkflowRun,
) -> Unit {
  let run_id = run.id.to_int64()
  let batch_size = 50
  let mut i = 0
  while i < results.length() {
    let b = StringBuilder()
    b.write_string(
      "INSERT INTO test_results (id, workflow_run_id, suite, test_name, status, duration_ms, error_message, commit_sha, created_at) VALUES ",
    )
    let end = if i + batch_size < results.length() {
      i + batch_size
    } else {
      results.length()
    }
    for j = i; j < end; j = j + 1 {
      if j > i {
        b.write_string(", ")
      }
      let r = results[j]
      b.write_string("(nextval('test_results_id_seq'), ")
      b.write_string(run_id.to_string())
      b.write_string(", '")
      b.write_string(sql_escape(r.suite))
      b.write_string("', '")
      b.write_string(sql_escape(r.test_name))
      b.write_string("', '")
      b.write_string(r.status)
      b.write_string("', ")
      b.write_string(r.duration_ms.to_string())
      b.write_string(", '")
      b.write_string(sql_escape(r.error_message))
      b.write_string("', '")
      b.write_string(sql_escape(run.head_sha))
      b.write_string("', '")
      b.write_string(sql_escape(run.created_at))
      b.write_string("')")
    }
    exec_sql(db, b.to_string())
    i = end
  }
}
