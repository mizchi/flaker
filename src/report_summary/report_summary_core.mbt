///|
priv struct TotalsAcc {
  mut total : Int32
  mut passed : Int32
  mut failed : Int32
  mut flaky : Int32
  mut skipped : Int32
  mut retries : Int32
  mut duration_ms : Int32
}

///|
fn empty_totals_acc() -> TotalsAcc {
  TotalsAcc::{
    total: 0,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    retries: 0,
    duration_ms: 0,
  }
}

///|
fn add_to_totals(
  totals : TotalsAcc,
  entry : @types.ReportSummaryTestInput,
) -> Unit {
  totals.total += 1
  totals.retries += entry.retry_count
  totals.duration_ms += entry.duration_ms
  match entry.status {
    "passed" => totals.passed += 1
    "failed" => totals.failed += 1
    "flaky" => totals.flaky += 1
    "skipped" => totals.skipped += 1
    _ => ()
  }
}

///|
fn freeze_totals(totals : TotalsAcc) -> @types.ReportTotalsInput {
  @types.ReportTotalsInput::{
    total: totals.total,
    passed: totals.passed,
    failed: totals.failed,
    flaky: totals.flaky,
    skipped: totals.skipped,
    retries: totals.retries,
    duration_ms: totals.duration_ms,
  }
}

///|
pub fn summarize_report(
  tests : Array[@types.ReportSummaryTestInput],
) -> @types.ReportSummaryOutput {
  let totals = empty_totals_acc()
  let file_totals_map : Map[String, TotalsAcc] = Map([])
  let unstable_test_ids : Array[String] = []

  for entry in tests {
    add_to_totals(totals, entry)
    let suite_totals = file_totals_map.get_or_init(entry.suite, fn() {
      empty_totals_acc()
    })
    add_to_totals(suite_totals, entry)
    if entry.status == "failed" || entry.status == "flaky" {
      unstable_test_ids.push(entry.test_id)
    }
  }

  let file_totals : Array[@types.ReportFileTotalsOutput] = []
  file_totals_map.each(fn(suite, totals) {
    file_totals.push(@types.ReportFileTotalsOutput::{
      suite,
      totals: freeze_totals(totals),
    })
  })
  file_totals.sort_by(fn(a, b) { a.suite.lexical_compare(b.suite) })

  @types.ReportSummaryOutput::{
    totals: freeze_totals(totals),
    file_totals,
    unstable_test_ids,
  }
}
