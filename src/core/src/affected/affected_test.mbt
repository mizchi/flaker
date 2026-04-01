///|
test "resolve_affected finds targets for changed paths" {
  let workflow =
    #|workflow(name="ci")
    #|node(id="auth", depends_on=[])
    #|node(id="home", depends_on=[])
    #|node(id="utils", depends_on=[])
    #|task(id="test-auth", node="auth", cmd="test", needs=[], srcs=["src/auth/**"])
    #|task(id="test-home", node="home", cmd="test", needs=[], srcs=["src/home/**"])
    #|task(id="test-utils", node="utils", cmd="test", needs=[], srcs=["src/utils/**"])
  let changed = ["src/auth/login.ts"]
  let affected = resolve_affected(workflow, changed)
  assert_true(affected.contains("test-auth"))
  assert_true(!affected.contains("test-home"))
}

///|
test "resolve_affected returns empty for no matches" {
  let workflow =
    #|workflow(name="ci")
    #|node(id="auth", depends_on=[])
    #|task(id="test-auth", node="auth", cmd="test", needs=[], srcs=["src/auth/**"])
  let changed = ["src/payments/stripe.ts"]
  let affected = resolve_affected(workflow, changed)
  assert_eq(affected.length(), 0)
}

///|
test "resolve_affected expands transitive dependencies" {
  let workflow =
    #|workflow(name="ci")
    #|node(id="lib", depends_on=[])
    #|node(id="app", depends_on=["lib"])
    #|task(id="lib", node="lib", cmd="test", needs=[], srcs=["src/lib/**"])
    #|task(id="app", node="app", cmd="test", needs=["lib"], srcs=["src/app/**"])
  let changed = ["src/lib/core.ts"]
  let affected = resolve_affected(workflow, changed)
  assert_true(affected.contains("lib"))
  // "app" depends on "lib", so it should also be affected
  assert_true(affected.contains("app"))
}

///|
test "resolve_affected normalizes windows path separators" {
  let workflow =
    #|workflow(name="ci")
    #|node(id="auth", depends_on=[])
    #|task(id="test-auth", node="auth", cmd="test", needs=[], srcs=["src/auth/**"])
  let changed = ["src\\auth\\login.ts"]
  let affected = resolve_affected(workflow, changed)
  assert_true(affected.contains("test-auth"))
}
