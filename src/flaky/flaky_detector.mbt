///|
struct TestKey {
  suite : String
  test_name : String
} derive(Eq, Hash, Show)

///|
priv struct TestAgg {
  mut total : Int
  mut fail_count : Int
  mut flaky_retry_count : Int
}

///|
pub fn detect_flaky(input : @types.DetectInput) -> @types.DetectOutput {
  let map : Map[TestKey, TestAgg] = {}
  for entry in input.results {
    let key = TestKey::{ suite: entry.suite, test_name: entry.test_name }
    let agg = map.get_or_init(key, fn() {
      TestAgg::{ total: 0, fail_count: 0, flaky_retry_count: 0 }
    })
    agg.total += 1
    if entry.status == "failed" {
      agg.fail_count += 1
    }
    if entry.retry_count > 0 && entry.status == "passed" {
      agg.flaky_retry_count += 1
    }
  }
  let results : Array[@types.FlakyResult] = []
  map.each(fn(key, agg) {
    if agg.total < input.min_runs {
      return
    }
    let flaky_rate = (
        agg.fail_count.to_double() + agg.flaky_retry_count.to_double()
      ) /
      agg.total.to_double() *
      100.0
    if flaky_rate < input.threshold {
      return
    }
    results.push(@types.FlakyResult::{
      suite: key.suite,
      test_name: key.test_name,
      flaky_rate,
      total_runs: agg.total,
      fail_count: agg.fail_count,
      flaky_retry_count: agg.flaky_retry_count,
      is_quarantined: false,
    })
  })
  results.sort_by(fn(a, b) {
    if a.flaky_rate > b.flaky_rate {
      -1
    } else if a.flaky_rate < b.flaky_rate {
      1
    } else {
      0
    }
  })
  @types.DetectOutput::{ flaky_tests: results }
}
