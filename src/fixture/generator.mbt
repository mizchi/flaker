///|
/// 32-bit LCG (matches TypeScript fixture-generator)
fn lcg32(state : UInt32) -> (UInt32, Double) {
  let next = state * 1664525U + 1013904223U
  (next, next.to_double() / 4294967296.0)
}

///|
/// Generate synthetic fixture data for evaluation
pub fn generate_fixture(config : FixtureConfig) -> FixtureData {
  let mut rng = config.seed.reinterpret_as_uint()
  fn rand() -> Double {
    let (next, value) = lcg32(rng)
    rng = next
    value
  }

  let file_count = {
    let raw = (config.test_count.to_double() / config.tests_per_file.to_double())
      .ceil()
      .to_int()
    if raw < 1 {
      1
    } else {
      raw
    }
  }

  // Generate files
  let files : Array[String] = Array::makei(file_count, fn(i) {
    "src/module_\{i}.ts"
  })

  // Generate tests and build file→suite dependency map
  let file_dep_suites : Array[Array[String]] = Array::makei(file_count, fn(_i) {
    []
  })
  let flaky_count = (config.test_count.to_double() * config.flaky_rate + 0.5).to_int()
  let tests : Array[FixtureTest] = Array::makei(config.test_count, fn(i) {
    let file_idx = i % file_count
    let suite = "tests/module_\{file_idx}/test_\{i}.spec.ts"
    file_dep_suites[file_idx].push(suite)
    FixtureTest::{ suite, test_name: "test_\{i}", is_flaky: i < flaky_count, }
  })

  let file_deps : Array[FixtureFileDep] = Array::makei(file_count, fn(i) {
    FixtureFileDep::{ file: files[i], suites: file_dep_suites[i], }
  })

  // Generate commits
  let commits : Array[FixtureCommit] = []
  for c = 0; c < config.commit_count; c = c + 1 {
    let sha = {
      let pad = if c < 10 {
        "000"
      } else if c < 100 {
        "00"
      } else if c < 1000 {
        "0"
      } else {
        ""
      }
      "fixture-sha-\{pad}\{c}"
    }

    // Select changed files
    let changed_set : Array[Bool] = Array::make(file_count, false)
    let mut changed_count = 0
    let target_count = if config.files_per_commit < file_count {
      config.files_per_commit
    } else {
      file_count
    }
    let changed_files : Array[FixtureChangedFile] = []
    while changed_count < target_count {
      let idx = (rand() * file_count.to_double()).to_int()
      let idx_clamped = if idx >= file_count { file_count - 1 } else { idx }
      if !changed_set[idx_clamped] {
        changed_set[idx_clamped] = true
        changed_count += 1
        changed_files.push(FixtureChangedFile::{
          file_path: files[idx_clamped],
          change_type: "modified",
        })
      }
    }

    // Build dependent test index
    let dependent : Array[Bool] = Array::make(config.test_count, false)
    for i = 0; i < file_count; i = i + 1 {
      if changed_set[i] {
        for suite in file_dep_suites[i] {
          for t = 0; t < tests.length(); t = t + 1 {
            if tests[t].suite == suite {
              dependent[t] = true
            }
          }
        }
      }
    }

    // Generate test results
    let test_results : Array[FixtureCommitResult] = []
    for i = 0; i < tests.length(); i = i + 1 {
      let t = tests[i]
      let is_dependent = dependent[i]
      let mut failed = false
      if is_dependent && rand() < config.co_failure_strength {
        failed = true
      }
      if t.is_flaky && rand() < config.flaky_rate {
        failed = true
      }
      test_results.push(FixtureCommitResult::{
        suite: t.suite,
        test_name: t.test_name,
        status: if failed {
          "failed"
        } else {
          "passed"
        },
      })
    }

    commits.push(FixtureCommit::{ sha, changed_files, test_results, })
  } nobreak {
    ()
  }

  FixtureData::{ tests, files, file_deps, commits, config, }
}
