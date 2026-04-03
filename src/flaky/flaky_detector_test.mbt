///|
test "detect_flaky finds flaky tests" {
  let entries : Array[@types.TestRunEntry] = []
  // 10 entries for "should redirect": 3 failed, 2 retry passed, 5 passed
  for _ in 0..<3 {
    entries.push(@types.TestRunEntry::{
      suite: "auth",
      test_name: "should redirect",
      status: "failed",
      retry_count: 0,
    })
  }
  for _ in 0..<2 {
    entries.push(@types.TestRunEntry::{
      suite: "auth",
      test_name: "should redirect",
      status: "passed",
      retry_count: 1,
    })
  }
  for _ in 0..<5 {
    entries.push(@types.TestRunEntry::{
      suite: "auth",
      test_name: "should redirect",
      status: "passed",
      retry_count: 0,
    })
  }
  // 5 all-passed for "should display"
  for _ in 0..<5 {
    entries.push(@types.TestRunEntry::{
      suite: "auth",
      test_name: "should display",
      status: "passed",
      retry_count: 0,
    })
  }
  let input = @types.DetectInput::{
    results: entries,
    threshold: 1.0,
    min_runs: 3,
  }
  let output = @flaky.detect_flaky(input)
  assert_eq(output.flaky_tests.length(), 1)
  assert_eq(output.flaky_tests[0].test_name, "should redirect")
  assert_eq(output.flaky_tests[0].flaky_rate, 50.0)
}

///|
test "detect_flaky respects min_runs" {
  let entries : Array[@types.TestRunEntry] = [
    @types.TestRunEntry::{
      suite: "auth",
      test_name: "should redirect",
      status: "failed",
      retry_count: 0,
    },
    @types.TestRunEntry::{
      suite: "auth",
      test_name: "should redirect",
      status: "passed",
      retry_count: 0,
    },
  ]
  let input = @types.DetectInput::{
    results: entries,
    threshold: 1.0,
    min_runs: 5,
  }
  let output = @flaky.detect_flaky(input)
  assert_eq(output.flaky_tests.length(), 0)
}

///|
test "detect_flaky respects threshold" {
  let entries : Array[@types.TestRunEntry] = []
  entries.push(@types.TestRunEntry::{
    suite: "auth",
    test_name: "should redirect",
    status: "failed",
    retry_count: 0,
  })
  for _ in 0..<99 {
    entries.push(@types.TestRunEntry::{
      suite: "auth",
      test_name: "should redirect",
      status: "passed",
      retry_count: 0,
    })
  }
  let input = @types.DetectInput::{
    results: entries,
    threshold: 2.0,
    min_runs: 1,
  }
  let output = @flaky.detect_flaky(input)
  assert_eq(output.flaky_tests.length(), 0)
}
