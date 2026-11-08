///|
pub fn sample_login_smoke() -> Array[@flaker.TestMeta] {
  let meta = @flaker.build_sampling_meta(
    [
      @flaker.SamplingHistoryRowInput::{
        suite: "tests/login.spec.ts",
        test_name: "works",
        task_id: Some("web-login"),
        filter: Some("@smoke"),
        variant: None,
        test_id: Some("login-smoke"),
        status: "passed",
        retry_count: 1,
        duration_ms: 1200,
        created_at: "2026-04-03T00:00:00.000Z",
      },
    ],
    [
      @flaker.SamplingListedTestInput::{
        suite: "tests/login.spec.ts",
        test_name: "works",
        task_id: Some("web-login"),
        filter: Some("@smoke"),
        variant: None,
        test_id: Some("login-smoke"),
      },
    ],
  )
  @flaker.sample_weighted(meta, count=1, seed=1UL)
}

///|
pub fn summarize_local_vs_ci() -> @flaker.SamplingKpiOutput {
  @flaker.build_sampling_kpi([
    @flaker.EvalCommitSignalInput::{
      commit_sha: "abc",
      run_kind: "local",
      run_count: 1,
      distinct_tests: 1,
      failure_signals: 0,
      duration_ms: Some(1000),
      fallback_used: false,
    },
    @flaker.EvalCommitSignalInput::{
      commit_sha: "abc",
      run_kind: "ci",
      run_count: 1,
      distinct_tests: 10,
      failure_signals: 0,
      duration_ms: Some(10000),
      fallback_used: false,
    },
  ])
}

///|
pub fn example_stable_identity() -> @flaker.ResolvedStableTestIdentityOutput {
  @flaker.resolve_test_identity(@flaker.StableTestIdentityInput::{
    suite: "tests/a.spec.ts",
    test_name: "login works",
    task_id: Some("task-a"),
    filter: Some("@smoke"),
    variant: Some([
      @flaker.StableVariantEntryInput::{ key: "os", value: "linux", },
    ]),
    test_id: None,
  })
}

///|
pub fn example_quarantine_exit_code() -> Int32 {
  @flaker.compute_quarantine_exit_code(
    [
      @flaker.QuarantineRuntimeResultInput::{
        status: "failed",
        quarantine_mode: Some("allow_failure"),
      },
    ],
    1,
  )
}

///|
pub fn example_affected_report() -> @flaker.AffectedReportCoreOutput {
  @flaker.build_affected_report_from_input(@flaker.AffectedReportInput::{
    targets: [
      @flaker.AffectedTargetInput::{
        spec: "tests/core.spec.ts",
        task_id: "core",
        filter: None,
      },
      @flaker.AffectedTargetInput::{
        spec: "tests/app.spec.ts",
        task_id: "app",
        filter: None,
      },
    ],
    direct_selections: [
      @flaker.AffectedDirectSelectionInput::{
        spec: "tests/core.spec.ts",
        task_id: "core",
        filter: None,
        matched_paths: ["packages/core/src/index.ts"],
        match_reasons: ["package:core"],
      },
    ],
    transitive_tasks: [
      @flaker.AffectedTransitiveTaskInput::{
        task_id: "app",
        included_by: ["core"],
        match_reasons: ["dependency:core"],
      },
    ],
    unmatched: [],
  })
}
