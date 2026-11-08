///|
test "root package exposes sampling and identity helpers" {
  let sampled = @flaker.sample_random(
    [
      @contracts.TestMeta::{
        suite: "tests/a.spec.ts",
        test_name: "a",
        flaky_rate: 0.0,
        total_runs: 1,
        fail_count: 0,
        last_run_at: "2026-04-03T00:00:00.000Z",
        avg_duration_ms: 10,
        previously_failed: false,
        is_new: false,
        task_id: Some("task-a"),
        filter: None,
        test_id: Some("a"),
        co_failure_boost: None,
      },
      @contracts.TestMeta::{
        suite: "tests/b.spec.ts",
        test_name: "b",
        flaky_rate: 80.0,
        total_runs: 5,
        fail_count: 2,
        last_run_at: "2026-04-03T00:00:00.000Z",
        avg_duration_ms: 20,
        previously_failed: true,
        is_new: false,
        task_id: Some("task-b"),
        filter: Some("@smoke"),
        test_id: Some("b"),
        co_failure_boost: None,
      },
    ],
    count=1,
    seed=1UL,
  )

  assert_eq(sampled.length(), 1)

  let stable_id = @flaker.create_stable_test_id(@contracts.StableTestIdentityInput::{
    suite: "tests/b.spec.ts",
    test_name: "b",
    task_id: Some("task-b"),
    filter: Some("@smoke"),
    variant: None,
    test_id: None,
  })

  assert_eq(
    stable_id, "{\"taskId\":\"task-b\",\"suite\":\"tests/b.spec.ts\",\"testName\":\"b\",\"filter\":\"@smoke\",\"variant\":null}",
  )
}

///|
test "root package exposes reporting, policy, and metrics helpers" {
  let summary = @flaker.summarize_report([
    @contracts.ReportSummaryTestInput::{
      test_id: "t1",
      suite: "tests/a.spec.ts",
      status: "passed",
      duration_ms: 10,
      retry_count: 0,
    },
    @contracts.ReportSummaryTestInput::{
      test_id: "t2",
      suite: "tests/a.spec.ts",
      status: "failed",
      duration_ms: 20,
      retry_count: 1,
    },
  ])
  assert_eq(summary.totals.failed, 1)

  let exit_code = @flaker.compute_quarantine_exit_code(
    [
      @contracts.QuarantineRuntimeResultInput::{
        status: "failed",
        quarantine_mode: Some("allow_failure"),
      },
    ],
    1,
  )
  assert_eq(exit_code, 0)

  let config = @flaker.run_config_check(
    [
      @contracts.ConfigCheckListedTestInput::{
        suite: "tests/a.spec.ts",
        task_id: "task-a",
        filter: None,
      },
    ],
    ["tests/a.spec.ts"],
    [
      @contracts.ConfigCheckTaskDefinitionInput::{
        task_id: "task-a",
        node: Some("node-a"),
        needs: [],
        srcs: ["src/a/**"],
      },
    ],
  )
  assert_eq(config.summary.task_count, 1)

  let kpi = @flaker.build_sampling_kpi([
    @contracts.EvalCommitSignalInput::{
      commit_sha: "abc",
      run_kind: "local",
      run_count: 1,
      distinct_tests: 10,
      failure_signals: 0,
      duration_ms: Some(60000),
      fallback_used: false,
    },
    @contracts.EvalCommitSignalInput::{
      commit_sha: "abc",
      run_kind: "ci",
      run_count: 1,
      distinct_tests: 100,
      failure_signals: 0,
      duration_ms: Some(300000),
      fallback_used: false,
    },
  ])
  assert_eq(kpi.matched_commits, 1)
  assert_eq(kpi.avg_saved_minutes, Some(4.0))

  let report = @flaker.build_affected_report_from_input(@flaker.AffectedReportInput::{
    targets: [
      @flaker.AffectedTargetInput::{
        spec: "tests/a.spec.ts",
        task_id: "task-a",
        filter: None,
      },
    ],
    direct_selections: [
      @flaker.AffectedDirectSelectionInput::{
        spec: "tests/a.spec.ts",
        task_id: "task-a",
        filter: None,
        matched_paths: ["src/a.ts"],
        match_reasons: ["package:a"],
      },
    ],
    transitive_tasks: [],
    unmatched: [],
  })
  assert_eq(report.summary.selected_count, 1)
}
