///|
test "classify_report_diff matches report diff bucket semantics" {
  let result = classify_report_diff([
    @types.ReportDiffStatusInput::{
      test_id: "new-failure",
      base_status: "passed",
      head_status: "failed",
    },
    @types.ReportDiffStatusInput::{
      test_id: "new-flaky",
      base_status: "passed",
      head_status: "flaky",
    },
    @types.ReportDiffStatusInput::{
      test_id: "resolved-failure",
      base_status: "failed",
      head_status: "passed",
    },
    @types.ReportDiffStatusInput::{
      test_id: "resolved-flaky",
      base_status: "flaky",
      head_status: "passed",
    },
    @types.ReportDiffStatusInput::{
      test_id: "persistent-flaky",
      base_status: "flaky",
      head_status: "flaky",
    },
    @types.ReportDiffStatusInput::{
      test_id: "failed-to-flaky",
      base_status: "failed",
      head_status: "flaky",
    },
  ])

  assert_eq(result.new_failures, ["new-failure"])
  assert_eq(result.new_flaky, ["new-flaky"])
  assert_eq(result.resolved_failures, ["resolved-failure", "failed-to-flaky"])
  assert_eq(result.resolved_flaky, ["resolved-flaky"])
  assert_eq(result.persistent_flaky, ["persistent-flaky"])
}
