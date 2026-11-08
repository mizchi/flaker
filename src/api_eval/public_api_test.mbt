///|
test "consumer package can use root sampling and metrics API" {
  let sampled = @api_eval.sample_login_smoke()
  assert_eq(sampled.length(), 1)
  assert_eq(sampled[0].test_id, Some("login-smoke"))

  let kpi = @api_eval.summarize_local_vs_ci()
  assert_eq(kpi.matched_commits, 1)
  assert_eq(kpi.avg_sample_ratio, Some(10.0))
}

///|
test "consumer package can use root report, policy, and identity API" {
  let summary = @flaker.summarize_report([
    @flaker.ReportSummaryTestInput::{
      test_id: "t1",
      suite: "tests/a.spec.ts",
      status: "flaky",
      duration_ms: 30,
      retry_count: 1,
    },
    @flaker.ReportSummaryTestInput::{
      test_id: "t2",
      suite: "tests/a.spec.ts",
      status: "passed",
      duration_ms: 20,
      retry_count: 0,
    },
  ])
  assert_eq(summary.totals.flaky, 1)

  let stable = @api_eval.example_stable_identity()
  assert_eq(stable.task_id, "task-a")
  assert_true(stable.test_id.contains("\"taskId\":\"task-a\""))

  let exit_code = @api_eval.example_quarantine_exit_code()
  assert_eq(exit_code, 0)
}

///|
test "consumer package can use root graph and affected API" {
  let graph = @flaker.DependencyGraphInput::{
    root_dir: "/tmp/repo",
    nodes: [
      @flaker.GraphNodeInput::{
        id: "core",
        path: "packages/core",
        dependencies: [],
        source_patterns: ["packages/core/src/**"],
        test_patterns: ["packages/core/tests/**"],
      },
      @flaker.GraphNodeInput::{
        id: "app",
        path: "packages/app",
        dependencies: ["core"],
        source_patterns: ["packages/app/src/**"],
        test_patterns: ["packages/app/tests/**"],
      },
    ],
  }
  let affected_nodes = @flaker.find_affected_nodes(graph, [
    "packages/core/src/index.ts",
  ])
  assert_eq(affected_nodes, ["core", "app"])

  let report = @api_eval.example_affected_report()
  assert_eq(report.summary.selected_count, 2)
  assert_eq(report.unmatched.length(), 0)
}
