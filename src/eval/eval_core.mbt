///|
fn round_metric(value : Double) -> Double {
  (value * 10.0).round() / 10.0
}

///|
fn percentile_nearest_rank(values : Array[Int], percentile : Double) -> Double? {
  if values.length() == 0 {
    return None
  }
  let sorted = values.copy()
  sorted.sort()
  let rank = (percentile * sorted.length().to_double()).ceil().to_int()
  let index = if rank <= 0 { 0 } else { rank - 1 }
  Some(sorted[index].to_double())
}

///|
fn median(values : Array[Int]) -> Double? {
  if values.length() == 0 {
    return None
  }
  let sorted = values.copy()
  sorted.sort()
  let middle = sorted.length() / 2
  if sorted.length() % 2 == 1 {
    Some(sorted[middle].to_double())
  } else {
    Some((sorted[middle - 1].to_double() + sorted[middle].to_double()) / 2.0)
  }
}

///|
fn to_rate(numerator : Int, denominator : Int) -> Double? {
  if denominator == 0 {
    return None
  }
  Some(round_metric(numerator.to_double() * 100.0 / denominator.to_double()))
}

///|
fn average(values : Array[Int]) -> Double? {
  if values.length() == 0 {
    return None
  }
  let mut total = 0
  for value in values {
    total += value
  }
  Some(round_metric(total.to_double() / values.length().to_double()))
}

///|
fn average_ratio(numerators : Array[Int], denominators : Array[Int]) -> Double? {
  if numerators.length() == 0 || denominators.length() == 0 {
    return None
  }
  let mut total = 0.0
  let mut count = 0
  for i in 0..<numerators.length() {
    let denominator = denominators[i]
    if denominator > 0 {
      total += numerators[i].to_double() / denominator.to_double() * 100.0
      count += 1
    }
  }
  if count == 0 {
    return None
  }
  Some(round_metric(total / count.to_double()))
}

///|
fn average_duration_delta_minutes(
  local_durations : Array[Int],
  ci_durations : Array[Int],
) -> Double? {
  if local_durations.length() == 0 || ci_durations.length() == 0 {
    return None
  }
  let mut total = 0.0
  let mut count = 0
  for i in 0..<local_durations.length() {
    total += (ci_durations[i] - local_durations[i]).to_double() / 60000.0
    count += 1
  }
  if count == 0 {
    return None
  }
  Some(round_metric(total / count.to_double()))
}

///|
pub fn build_sampling_kpi(
  rows : Array[@types.EvalCommitSignalInput],
) -> @types.SamplingKpiOutput {
  let local_by_commit : Map[String, @types.EvalCommitSignalInput] = {}
  let ci_by_commit : Map[String, @types.EvalCommitSignalInput] = {}
  let local_order : Array[String] = []
  let ci_order : Array[String] = []

  for row in rows {
    if row.run_kind == "local" {
      if !local_by_commit.contains(row.commit_sha) {
        local_order.push(row.commit_sha)
      }
      local_by_commit.set(row.commit_sha, row)
    } else {
      if !ci_by_commit.contains(row.commit_sha) {
        ci_order.push(row.commit_sha)
      }
      ci_by_commit.set(row.commit_sha, row)
    }
  }

  let matched_commit_shas : Array[String] = []
  let mut local_only_commits = 0
  let mut fallback_runs = 0
  for commit_sha in local_order {
    if local_by_commit[commit_sha].fallback_used {
      fallback_runs += 1
    }
    if ci_by_commit.contains(commit_sha) {
      matched_commit_shas.push(commit_sha)
    } else {
      local_only_commits += 1
    }
  }

  let mut ci_only_commits = 0
  for commit_sha in ci_order {
    if !local_by_commit.contains(commit_sha) {
      ci_only_commits += 1
    }
  }

  let sample_sizes : Array[Int] = []
  let ci_test_counts : Array[Int] = []
  let local_durations : Array[Int] = []
  let ci_durations : Array[Int] = []

  let mut local_pass_commits = 0
  let mut ci_pass_when_local_pass = 0
  let mut local_fail_commits = 0
  let mut ci_fail_when_local_fail = 0
  let mut local_pass_but_ci_fail = 0
  let mut local_fail_but_ci_pass = 0
  let mut true_positive = 0
  let mut false_positive = 0
  let mut false_negative = 0
  let mut true_negative = 0

  for commit_sha in matched_commit_shas {
    let local_signal = local_by_commit[commit_sha]
    let ci = ci_by_commit[commit_sha]
    let local_failed = local_signal.failure_signals > 0
    let ci_failed = ci.failure_signals > 0

    sample_sizes.push(local_signal.distinct_tests)
    ci_test_counts.push(ci.distinct_tests)
    match (local_signal.duration_ms, ci.duration_ms) {
      (Some(local_duration), Some(ci_duration)) => {
        local_durations.push(local_duration)
        ci_durations.push(ci_duration)
      }
      _ => ()
    }

    if local_failed {
      local_fail_commits += 1
      if ci_failed {
        ci_fail_when_local_fail += 1
        true_positive += 1
      } else {
        local_fail_but_ci_pass += 1
        false_positive += 1
      }
    } else {
      local_pass_commits += 1
      if ci_failed {
        local_pass_but_ci_fail += 1
        false_negative += 1
      } else {
        ci_pass_when_local_pass += 1
        true_negative += 1
      }
    }
  }

  @types.SamplingKpiOutput::{
    matched_commits: matched_commit_shas.length(),
    local_only_commits,
    ci_only_commits,
    avg_local_sample_size: average(sample_sizes),
    median_local_sample_size: match median(sample_sizes) {
      Some(value) => Some(round_metric(value))
      None => None
    },
    p95_local_sample_size: match percentile_nearest_rank(sample_sizes, 0.95) {
      Some(value) => Some(round_metric(value))
      None => None
    },
    avg_ci_test_count: average(ci_test_counts),
    avg_sample_ratio: average_ratio(sample_sizes, ci_test_counts),
    avg_saved_minutes: average_duration_delta_minutes(
      local_durations, ci_durations,
    ),
    fallback_runs,
    fallback_rate: to_rate(fallback_runs, local_order.length()),
    pass_signal: @types.SamplingKpiSignalOutput::{
      local_commits: local_pass_commits,
      ci_when_local: ci_pass_when_local_pass,
      rate: to_rate(ci_pass_when_local_pass, local_pass_commits),
    },
    fail_signal: @types.SamplingKpiSignalOutput::{
      local_commits: local_fail_commits,
      ci_when_local: ci_fail_when_local_fail,
      rate: to_rate(ci_fail_when_local_fail, local_fail_commits),
    },
    misses: @types.SamplingKpiMissesOutput::{
      local_pass_but_ci_fail,
      local_fail_but_ci_pass,
      false_negative_rate: to_rate(local_pass_but_ci_fail, local_pass_commits),
      false_positive_rate: to_rate(local_fail_but_ci_pass, local_fail_commits),
    },
    confusion_matrix: @types.SamplingKpiConfusionMatrixOutput::{
      true_positive,
      false_positive,
      false_negative,
      true_negative,
    },
  }
}
