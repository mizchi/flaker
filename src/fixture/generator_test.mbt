///|
test "generate_fixture returns correct structure" {
  let config = @fixture.FixtureConfig::{
    test_count: 20,
    commit_count: 5,
    flaky_rate: 0.15,
    co_failure_strength: 0.8,
    files_per_commit: 2,
    tests_per_file: 5,
    sample_percentage: 50.0,
    seed: 42,
  }
  let fixture = @fixture.generate_fixture(config)

  // 20 tests / 5 per file = 4 files
  assert_eq(fixture.files.length(), 4)
  assert_eq(fixture.tests.length(), 20)
  assert_eq(fixture.commits.length(), 5)
  assert_eq(fixture.file_deps.length(), 4)

  // flaky_count = round(20 * 0.15) = 3
  let flaky_count = fixture.tests
    .iter()
    .filter(fn(t) { t.is_flaky })
    .fold(init=0, fn(acc, _t) { acc + 1 })
  assert_eq(flaky_count, 3)

  // Each commit should have 2 changed files
  for commit in fixture.commits {
    assert_eq(commit.changed_files.length(), 2)
    assert_eq(commit.test_results.length(), 20)
  }
}

///|
test "generate_fixture is deterministic" {
  let config = @fixture.FixtureConfig::{
    test_count: 10,
    commit_count: 3,
    flaky_rate: 0.2,
    co_failure_strength: 0.5,
    files_per_commit: 1,
    tests_per_file: 5,
    sample_percentage: 50.0,
    seed: 123,
  }
  let a = @fixture.generate_fixture(config)
  let b = @fixture.generate_fixture(config)

  assert_eq(a.tests.length(), b.tests.length())
  assert_eq(a.commits.length(), b.commits.length())

  // Same results for each commit
  for i = 0; i < a.commits.length(); i = i + 1 {
    assert_eq(a.commits[i].sha, b.commits[i].sha)
    for j = 0; j < a.commits[i].test_results.length(); j = j + 1 {
      assert_eq(
        a.commits[i].test_results[j].status,
        b.commits[i].test_results[j].status,
      )
    }
  }
}

///|
test "generate_fixture suite naming matches expected pattern" {
  let config = @fixture.FixtureConfig::{
    test_count: 3,
    commit_count: 1,
    flaky_rate: 0.0,
    co_failure_strength: 0.0,
    files_per_commit: 1,
    tests_per_file: 3,
    sample_percentage: 100.0,
    seed: 1,
  }
  let fixture = @fixture.generate_fixture(config)
  assert_eq(fixture.tests[0].suite, "tests/module_0/test_0.spec.ts")
  assert_eq(fixture.tests[1].suite, "tests/module_0/test_1.spec.ts")
  assert_eq(fixture.tests[2].suite, "tests/module_0/test_2.spec.ts")
  assert_eq(fixture.files[0], "src/module_0.ts")
}

///|
test "generate_fixture sha padding" {
  let config = @fixture.FixtureConfig::{
    test_count: 1,
    commit_count: 2,
    flaky_rate: 0.0,
    co_failure_strength: 0.0,
    files_per_commit: 1,
    tests_per_file: 1,
    sample_percentage: 100.0,
    seed: 1,
  }
  let fixture = @fixture.generate_fixture(config)
  assert_eq(fixture.commits[0].sha, "fixture-sha-0000")
  assert_eq(fixture.commits[1].sha, "fixture-sha-0001")
}
