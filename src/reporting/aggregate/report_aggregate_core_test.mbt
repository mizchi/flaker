///|
test "aggregate_report combines shard totals and unstable buckets" {
  let result = aggregate_report([
    @types.ReportAggregateShardInput::{
      shard_id: "shard-2",
      totals: @types.ReportTotalsInput::{
        total: 1,
        passed: 0,
        failed: 0,
        flaky: 1,
        skipped: 0,
        retries: 1,
        duration_ms: 30,
      },
      unstable: [
        @types.ReportAggregateUnstableStatusInput::{
          test_id: "card",
          status: "flaky",
        },
      ],
    },
    @types.ReportAggregateShardInput::{
      shard_id: "shard-1",
      totals: @types.ReportTotalsInput::{
        total: 2,
        passed: 1,
        failed: 1,
        flaky: 0,
        skipped: 0,
        retries: 0,
        duration_ms: 30,
      },
      unstable: [
        @types.ReportAggregateUnstableStatusInput::{
          test_id: "footer",
          status: "failed",
        },
        @types.ReportAggregateUnstableStatusInput::{
          test_id: "card",
          status: "failed",
        },
      ],
    },
  ])

  assert_eq(
    result.totals,
    @types.ReportTotalsInput::{
      total: 3,
      passed: 1,
      failed: 1,
      flaky: 1,
      skipped: 0,
      retries: 1,
      duration_ms: 60,
    },
  )
  assert_eq(result.shard_count, 2)
  assert_eq(result.unstable_count, 2)
  assert_eq(
    result.unstable,
    [
      @types.ReportAggregateUnstableBuckets::{
        test_id: "card",
        shard_ids: ["shard-1", "shard-2"],
        statuses: ["failed", "flaky"],
      },
      @types.ReportAggregateUnstableBuckets::{
        test_id: "footer",
        shard_ids: ["shard-1"],
        statuses: ["failed"],
      },
    ],
  )
}
