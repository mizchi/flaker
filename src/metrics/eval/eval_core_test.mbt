///|
test "build_sampling_kpi computes confusion matrix and sample metrics" {
  let report = build_sampling_kpi(
    [
      @types.EvalCommitSignalInput::{
        commit_sha: "commit-pass",
        run_kind: "local",
        run_count: 1,
        distinct_tests: 2,
        failure_signals: 0,
      },
      @types.EvalCommitSignalInput::{
        commit_sha: "commit-pass",
        run_kind: "ci",
        run_count: 1,
        distinct_tests: 4,
        failure_signals: 0,
      },
      @types.EvalCommitSignalInput::{
        commit_sha: "commit-fail",
        run_kind: "local",
        run_count: 1,
        distinct_tests: 2,
        failure_signals: 1,
      },
      @types.EvalCommitSignalInput::{
        commit_sha: "commit-fail",
        run_kind: "ci",
        run_count: 1,
        distinct_tests: 4,
        failure_signals: 1,
      },
      @types.EvalCommitSignalInput::{
        commit_sha: "commit-fn",
        run_kind: "local",
        run_count: 1,
        distinct_tests: 2,
        failure_signals: 0,
      },
      @types.EvalCommitSignalInput::{
        commit_sha: "commit-fn",
        run_kind: "ci",
        run_count: 1,
        distinct_tests: 4,
        failure_signals: 1,
      },
      @types.EvalCommitSignalInput::{
        commit_sha: "commit-fp",
        run_kind: "local",
        run_count: 1,
        distinct_tests: 2,
        failure_signals: 1,
      },
      @types.EvalCommitSignalInput::{
        commit_sha: "commit-fp",
        run_kind: "ci",
        run_count: 1,
        distinct_tests: 4,
        failure_signals: 0,
      },
      @types.EvalCommitSignalInput::{
        commit_sha: "local-only",
        run_kind: "local",
        run_count: 1,
        distinct_tests: 1,
        failure_signals: 0,
      },
      @types.EvalCommitSignalInput::{
        commit_sha: "ci-only",
        run_kind: "ci",
        run_count: 1,
        distinct_tests: 1,
        failure_signals: 0,
      },
    ],
  )

  assert_eq(report.matched_commits, 4)
  assert_eq(report.local_only_commits, 1)
  assert_eq(report.ci_only_commits, 1)
  assert_eq(report.avg_local_sample_size, Some(2.0))
  assert_eq(report.median_local_sample_size, Some(2.0))
  assert_eq(report.p95_local_sample_size, Some(2.0))
  assert_eq(report.avg_ci_test_count, Some(4.0))
  assert_eq(report.avg_sample_ratio, Some(50.0))
  assert_eq(report.pass_signal.local_commits, 2)
  assert_eq(report.pass_signal.ci_when_local, 1)
  assert_eq(report.pass_signal.rate, Some(50.0))
  assert_eq(report.fail_signal.local_commits, 2)
  assert_eq(report.fail_signal.ci_when_local, 1)
  assert_eq(report.fail_signal.rate, Some(50.0))
  assert_eq(report.misses.local_pass_but_ci_fail, 1)
  assert_eq(report.misses.local_fail_but_ci_pass, 1)
  assert_eq(report.misses.false_negative_rate, Some(50.0))
  assert_eq(report.misses.false_positive_rate, Some(50.0))
  assert_eq(report.confusion_matrix.true_positive, 1)
  assert_eq(report.confusion_matrix.false_positive, 1)
  assert_eq(report.confusion_matrix.false_negative, 1)
  assert_eq(report.confusion_matrix.true_negative, 1)
}
