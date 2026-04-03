///|
priv struct SamplingMetaAcc {
  suite : String
  test_name : String
  task_id : String
  filter : String?
  test_id : String
  mut total_runs : Int
  mut fail_count : Int
  mut failure_signals : Int
  mut total_duration_ms : Int
  mut last_run_at : String
}

///|
fn round_percent(numerator : Int, denominator : Int) -> Double {
  if denominator <= 0 {
    return 0.0
  }
  (numerator.to_double() * 100.0 / denominator.to_double() * 100.0).round() /
  100.0
}

///|
fn average_duration(total_duration_ms : Int, total_runs : Int) -> Int {
  if total_runs <= 0 {
    return 0
  }
  (total_duration_ms.to_double() / total_runs.to_double()).round().to_int()
}

///|
fn suite_test_key(suite : String, test_name : String) -> String {
  suite + "\u{0000}" + test_name
}

///|
fn init_listed_tests_by_key(
  listed_tests : Array[@types.SamplingListedTestInput],
) -> Map[String, Array[@types.SamplingListedTestInput]] {
  let by_key : Map[String, Array[@types.SamplingListedTestInput]] = {}
  for listed in listed_tests {
    let entries = by_key.get_or_init(
      suite_test_key(listed.suite, listed.test_name),
      fn() { [] },
    )
    entries.push(listed)
  }
  by_key
}

///|
fn resolve_listed_identity(
  listed : @types.SamplingListedTestInput,
) -> @types.ResolvedStableTestIdentityOutput {
  @identity_core.resolve_test_identity(@types.StableTestIdentityInput::{
    suite: listed.suite,
    test_name: listed.test_name,
    task_id: listed.task_id,
    filter: listed.filter,
    variant: listed.variant,
    test_id: listed.test_id,
  })
}

///|
fn is_default_history_identity(row : @types.SamplingHistoryRowInput) -> Bool {
  let default_test_id = @identity_core.create_stable_test_id(@types.StableTestIdentityInput::{
    suite: row.suite,
    test_name: row.test_name,
    task_id: None,
    filter: None,
    variant: None,
    test_id: None,
  })
  let has_default_task = match row.task_id {
    None => true
    Some(task_id) => task_id == row.suite
  }
  let has_default_test_id = match row.test_id {
    None => true
    Some(test_id) => test_id == default_test_id
  }
  has_default_task && row.filter == None && has_default_test_id
}

///|
fn resolve_history_identity(
  row : @types.SamplingHistoryRowInput,
  listed_by_key : Map[String, Array[@types.SamplingListedTestInput]],
) -> @types.ResolvedStableTestIdentityOutput {
  if is_default_history_identity(row) {
    let key = suite_test_key(row.suite, row.test_name)
    match listed_by_key.get(key) {
      Some(candidates) if candidates.length() == 1 =>
        return resolve_listed_identity(candidates[0])
      _ => ()
    }
  }

  @identity_core.resolve_test_identity(@types.StableTestIdentityInput::{
    suite: row.suite,
    test_name: row.test_name,
    task_id: row.task_id,
    filter: row.filter,
    variant: row.variant,
    test_id: row.test_id,
  })
}

///|
fn init_acc_from_identity(
  identity : @types.ResolvedStableTestIdentityOutput,
) -> SamplingMetaAcc {
  SamplingMetaAcc::{
    suite: identity.suite,
    test_name: identity.test_name,
    task_id: identity.task_id,
    filter: identity.filter,
    test_id: identity.test_id,
    total_runs: 0,
    fail_count: 0,
    failure_signals: 0,
    total_duration_ms: 0,
    last_run_at: "",
  }
}

///|
fn to_test_meta(acc : SamplingMetaAcc) -> @types.TestMeta {
  @types.TestMeta::{
    suite: acc.suite,
    test_name: acc.test_name,
    flaky_rate: round_percent(acc.failure_signals, acc.total_runs),
    total_runs: acc.total_runs,
    fail_count: acc.fail_count,
    last_run_at: acc.last_run_at,
    avg_duration_ms: average_duration(acc.total_duration_ms, acc.total_runs),
    previously_failed: acc.failure_signals > 0,
    is_new: acc.total_runs <= 1,
    task_id: Some(acc.task_id),
    filter: acc.filter,
    test_id: Some(acc.test_id),
    co_failure_boost: 0.0,
  }
}

///|
fn compare_meta(a : @types.TestMeta, b : @types.TestMeta) -> Int {
  let a_test_id = match a.test_id {
    Some(test_id) => test_id
    None => ""
  }
  let b_test_id = match b.test_id {
    Some(test_id) => test_id
    None => ""
  }
  let by_id = a_test_id.lexical_compare(b_test_id)
  if by_id != 0 {
    return by_id
  }
  let by_suite = a.suite.lexical_compare(b.suite)
  if by_suite != 0 {
    return by_suite
  }
  a.test_name.lexical_compare(b.test_name)
}

///|
pub fn build_sampling_meta(
  history_rows : Array[@types.SamplingHistoryRowInput],
  listed_tests : Array[@types.SamplingListedTestInput],
) -> Array[@types.TestMeta] {
  let listed_by_key = init_listed_tests_by_key(listed_tests)
  let acc_by_id : Map[String, SamplingMetaAcc] = {}

  for row in history_rows {
    let identity = resolve_history_identity(row, listed_by_key)
    let acc = acc_by_id.get_or_init(identity.test_id, fn() {
      init_acc_from_identity(identity)
    })
    acc.total_runs += 1
    if row.status == "failed" {
      acc.fail_count += 1
    }
    if row.status == "failed" ||
      row.status == "flaky" ||
      (row.retry_count > 0 && row.status == "passed") {
      acc.failure_signals += 1
    }
    acc.total_duration_ms += row.duration_ms
    if row.created_at.lexical_compare(acc.last_run_at) > 0 {
      acc.last_run_at = row.created_at
    }
  }

  for listed in listed_tests {
    let identity = resolve_listed_identity(listed)
    if !acc_by_id.contains(identity.test_id) {
      acc_by_id.set(identity.test_id, init_acc_from_identity(identity))
    }
  }

  let result : Array[@types.TestMeta] = []
  acc_by_id.each(fn(_, acc) { result.push(to_test_meta(acc)) })
  result.sort_by(compare_meta)
  result
}
