///|
test "create_stable_test_id normalizes variant key order and filter" {
  let a = create_stable_test_id(@types.StableTestIdentityInput::{
    suite: "tests/login.spec.ts",
    test_name: "should login",
    task_id: None,
    filter: Some("@smoke"),
    variant: Some([
      @types.StableVariantEntryInput::{ key: "os", value: "linux" },
      @types.StableVariantEntryInput::{ key: "browser", value: "chromium" },
    ]),
    test_id: None,
  })
  let b = create_stable_test_id(@types.StableTestIdentityInput::{
    suite: "tests/login.spec.ts",
    test_name: "should login",
    task_id: None,
    filter: Some("@smoke"),
    variant: Some([
      @types.StableVariantEntryInput::{ key: "browser", value: "chromium" },
      @types.StableVariantEntryInput::{ key: "os", value: "linux" },
    ]),
    test_id: None,
  })

  assert_eq(
    a, "{\"taskId\":\"tests/login.spec.ts\",\"suite\":\"tests/login.spec.ts\",\"testName\":\"should login\",\"filter\":\"@smoke\",\"variant\":{\"browser\":\"chromium\",\"os\":\"linux\"}}",
  )
  assert_eq(a, b)
}

///|
test "resolve_test_identity fills defaults and preserves provided test id" {
  let resolved = resolve_test_identity(@types.StableTestIdentityInput::{
    suite: "tests/login.spec.ts",
    test_name: "should login",
    task_id: None,
    filter: None,
    variant: Some([]),
    test_id: None,
  })

  assert_eq(resolved.task_id, "tests/login.spec.ts")
  assert_eq(resolved.filter, None)
  assert_eq(resolved.variant, None)
  assert_eq(
    resolved.test_id,
    "{\"taskId\":\"tests/login.spec.ts\",\"suite\":\"tests/login.spec.ts\",\"testName\":\"should login\",\"filter\":null,\"variant\":null}",
  )

  let preserved = resolve_test_identity(@types.StableTestIdentityInput::{
    suite: "tests/login.spec.ts",
    test_name: "should login",
    task_id: Some("task"),
    filter: None,
    variant: None,
    test_id: Some("preset"),
  })
  assert_eq(preserved.test_id, "preset")
}
