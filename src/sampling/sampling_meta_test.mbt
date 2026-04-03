///|
test "build_sampling_meta keeps split identities separate" {
  let result = @sampling.build_sampling_meta(
    [
      @types.SamplingHistoryRowInput::{
        suite: "tests/shared.spec.ts",
        test_name: "renders shared flow",
        task_id: Some("desktop"),
        filter: Some("@desktop"),
        variant: None,
        test_id: None,
        status: "passed",
        retry_count: 0,
        duration_ms: 100,
        created_at: "2026-04-01T00:00:00Z",
      },
      @types.SamplingHistoryRowInput::{
        suite: "tests/shared.spec.ts",
        test_name: "renders shared flow",
        task_id: Some("mobile"),
        filter: Some("@mobile"),
        variant: None,
        test_id: None,
        status: "passed",
        retry_count: 0,
        duration_ms: 120,
        created_at: "2026-04-01T00:01:00Z",
      },
    ],
    [],
  )

  assert_eq(result.length(), 2)
  let task_ids = result.map(fn(entry) {
    match entry.task_id {
      Some(task_id) => task_id
      None => ""
    }
  })
  assert_true(task_ids.contains("desktop"))
  assert_true(task_ids.contains("mobile"))

  let test_ids = result.map(fn(entry) {
    match entry.test_id {
      Some(test_id) => test_id
      None => ""
    }
  })
  assert_eq(test_ids.length(), 2)
  assert_true(test_ids[0] != test_ids[1])
}

///|
test "build_sampling_meta treats retry passes as flaky signals" {
  let result = @sampling.build_sampling_meta(
    [
      @types.SamplingHistoryRowInput::{
        suite: "tests/retry.spec.ts",
        test_name: "eventually passes",
        task_id: Some("retry"),
        filter: None,
        variant: None,
        test_id: None,
        status: "passed",
        retry_count: 1,
        duration_ms: 100,
        created_at: "2026-04-01T00:00:00Z",
      },
      @types.SamplingHistoryRowInput::{
        suite: "tests/retry.spec.ts",
        test_name: "eventually passes",
        task_id: Some("retry"),
        filter: None,
        variant: None,
        test_id: None,
        status: "passed",
        retry_count: 0,
        duration_ms: 100,
        created_at: "2026-04-01T00:01:00Z",
      },
    ],
    [],
  )

  assert_eq(result.length(), 1)
  assert_eq(result[0].suite, "tests/retry.spec.ts")
  assert_eq(result[0].flaky_rate, 50.0)
  assert_true(result[0].previously_failed)
}
