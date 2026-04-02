///|
fn make_test_meta(name : String, flaky_rate : Double) -> @types.TestMeta {
  @types.TestMeta::{
    suite: "suite",
    test_name: name,
    flaky_rate,
    total_runs: 10,
    fail_count: 0,
    last_run_at: "2026-01-01",
    avg_duration_ms: 100,
    previously_failed: false,
    is_new: false,
  }
}

///|
test "random sampling selects correct count" {
  let items = Array::makei(20, fn(i) {
    make_test_meta("test_" + i.to_string(), 0.0)
  })
  let result = @sampling.sample_random(items, count=5, seed=42UL)
  assert_eq(result.length(), 5)
}

///|
test "random sampling returns all when count > total" {
  let items = [make_test_meta("a", 0.0), make_test_meta("b", 0.0)]
  let result = @sampling.sample_random(items, count=10, seed=42UL)
  assert_eq(result.length(), 2)
}

///|
test "weighted sampling prefers flaky tests" {
  let stable = make_test_meta("stable", 0.0)
  let flaky = make_test_meta("flaky", 0.8)
  let items = [stable, flaky]
  let mut flaky_count = 0
  for i in 0..<100 {
    let result = @sampling.sample_weighted(
      items,
      count=1,
      seed=i.to_uint64() * 12345UL + 1UL,
    )
    if result[0].test_name == "flaky" {
      flaky_count += 1
    }
  }
  assert_true(flaky_count > 50)
}

///|
test "hybrid sampling prioritizes affected, failed, new, then weighted" {
  let meta : Array[@types.TestMeta] = [
    { suite: "affected.spec.ts", test_name: "affected", flaky_rate: 0.0, total_runs: 10, fail_count: 0, last_run_at: "", avg_duration_ms: 100, previously_failed: false, is_new: false },
    { suite: "failed.spec.ts", test_name: "prev_failed", flaky_rate: 50.0, total_runs: 10, fail_count: 5, last_run_at: "", avg_duration_ms: 100, previously_failed: true, is_new: false },
    { suite: "new.spec.ts", test_name: "new_test", flaky_rate: 0.0, total_runs: 0, fail_count: 0, last_run_at: "", avg_duration_ms: 100, previously_failed: false, is_new: true },
    { suite: "stable.spec.ts", test_name: "stable", flaky_rate: 0.0, total_runs: 100, fail_count: 0, last_run_at: "", avg_duration_ms: 100, previously_failed: false, is_new: false },
    { suite: "flaky.spec.ts", test_name: "flaky", flaky_rate: 80.0, total_runs: 100, fail_count: 80, last_run_at: "", avg_duration_ms: 100, previously_failed: false, is_new: false },
  ]
  let affected_suites = ["affected.spec.ts"]
  let result = @sampling.sample_hybrid(meta, affected_suites~, count=4, seed=42UL)
  assert_eq(result.length(), 4)
  let suites = result.map(fn(m) { m.suite })
  assert_true(suites.contains("affected.spec.ts"))
  assert_true(suites.contains("failed.spec.ts"))
  assert_true(suites.contains("new.spec.ts"))
}
