///|
test "summarize_report reduces totals, file totals, and unstable ids" {
  let result = summarize_report([
    @types.ReportSummaryTestInput::{
      test_id: "c",
      suite: "tests/b.spec.ts",
      status: "flaky",
      duration_ms: 30,
      retry_count: 1,
    },
    @types.ReportSummaryTestInput::{
      test_id: "a",
      suite: "tests/a.spec.ts",
      status: "passed",
      duration_ms: 10,
      retry_count: 0,
    },
    @types.ReportSummaryTestInput::{
      test_id: "b",
      suite: "tests/b.spec.ts",
      status: "failed",
      duration_ms: 20,
      retry_count: 0,
    },
    @types.ReportSummaryTestInput::{
      test_id: "d",
      suite: "tests/a.spec.ts",
      status: "skipped",
      duration_ms: 5,
      retry_count: 0,
    },
  ])

  assert_eq(
    result.totals,
    @types.ReportTotalsInput::{
      total: 4,
      passed: 1,
      failed: 1,
      flaky: 1,
      skipped: 1,
      retries: 1,
      duration_ms: 65,
    },
  )
  assert_eq(
    result.file_totals,
    [
      @types.ReportFileTotalsOutput::{
        suite: "tests/a.spec.ts",
        totals: @types.ReportTotalsInput::{
          total: 2,
          passed: 1,
          failed: 0,
          flaky: 0,
          skipped: 1,
          retries: 0,
          duration_ms: 15,
        },
      },
      @types.ReportFileTotalsOutput::{
        suite: "tests/b.spec.ts",
        totals: @types.ReportTotalsInput::{
          total: 2,
          passed: 0,
          failed: 1,
          flaky: 1,
          skipped: 0,
          retries: 1,
          duration_ms: 50,
        },
      },
    ],
  )
  assert_eq(result.unstable_test_ids, ["c", "b"])
}
