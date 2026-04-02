///|
priv struct TotalsAcc {
  mut total : Int
  mut passed : Int
  mut failed : Int
  mut flaky : Int
  mut skipped : Int
  mut retries : Int
  mut duration_ms : Int
}

///|
priv struct UnstableAcc {
  shard_ids : Array[String]
  statuses : Array[String]
}

///|
fn add_unique(values : Array[String], value : String) -> Unit {
  if !values.contains(value) {
    values.push(value)
  }
}

///|
fn sort_strings(values : Array[String]) -> Array[String] {
  let result = values.copy()
  result.sort_by(fn(a, b) { a.lexical_compare(b) })
  result
}

///|
pub fn aggregate_report(
  shards : Array[@types.ReportAggregateShardInput],
) -> @types.ReportAggregateOutput {
  let totals = TotalsAcc::{
    total: 0,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    retries: 0,
    duration_ms: 0,
  }
  let unstable_by_id : Map[String, UnstableAcc] = {}
  let unstable_order : Array[String] = []

  for shard in shards {
    let shard_totals = shard.totals
    totals.total += shard_totals.total
    totals.passed += shard_totals.passed
    totals.failed += shard_totals.failed
    totals.flaky += shard_totals.flaky
    totals.skipped += shard_totals.skipped
    totals.retries += shard_totals.retries
    totals.duration_ms += shard_totals.duration_ms

    for unstable in shard.unstable {
      let acc = unstable_by_id.get_or_init(unstable.test_id, fn() {
        unstable_order.push(unstable.test_id)
        UnstableAcc::{ shard_ids: [], statuses: [] }
      })
      add_unique(acc.shard_ids, shard.shard_id)
      add_unique(acc.statuses, unstable.status)
    }
  }

  let unstable : Array[@types.ReportAggregateUnstableBuckets] = []
  for test_id in unstable_order {
    let acc = unstable_by_id.get_or_init(test_id, fn() {
      UnstableAcc::{ shard_ids: [], statuses: [] }
    })
    unstable.push(@types.ReportAggregateUnstableBuckets::{
      test_id,
      shard_ids: sort_strings(acc.shard_ids),
      statuses: sort_strings(acc.statuses),
    })
  }

  @types.ReportAggregateOutput::{
    shard_count: shards.length(),
    unstable_count: unstable.length(),
    totals: @types.ReportTotalsInput::{
      total: totals.total,
      passed: totals.passed,
      failed: totals.failed,
      flaky: totals.flaky,
      skipped: totals.skipped,
      retries: totals.retries,
      duration_ms: totals.duration_ms,
    },
    unstable,
  }
}
