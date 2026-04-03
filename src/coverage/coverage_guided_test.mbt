test "select_by_coverage: basic greedy set cover" {
  let coverages = [
    TestCoverage::{ suite: "test_a", test_name: "a", edges: ["e1", "e2", "e3"] },
    TestCoverage::{ suite: "test_b", test_name: "b", edges: ["e2", "e4"] },
    TestCoverage::{ suite: "test_c", test_name: "c", edges: ["e3", "e5"] },
  ]
  let changed = ["e1", "e2", "e3", "e4", "e5"]

  let result = select_by_coverage(coverages, changed, count=2)

  // test_a covers 3 changed edges (e1,e2,e3) — picked first
  // test_b covers 1 new (e4), test_c covers 1 new (e5) — one of them picked
  assert_eq!(result.selected.length(), 2)
  assert_eq!(result.selected[0], "test_a")
  assert_eq!(result.covered_edges, 4) // 3 from test_a + 1 from next
  assert_eq!(result.total_changed_edges, 5)
}

test "select_by_coverage: stops when all edges covered" {
  let coverages = [
    TestCoverage::{ suite: "test_a", test_name: "a", edges: ["e1", "e2"] },
    TestCoverage::{ suite: "test_b", test_name: "b", edges: ["e3"] },
    TestCoverage::{ suite: "test_c", test_name: "c", edges: ["e1"] },
  ]
  let changed = ["e1", "e2", "e3"]

  let result = select_by_coverage(coverages, changed, count=10)

  // Only needs 2 tests to cover all 3 edges (test_a + test_b)
  assert_eq!(result.selected.length(), 2)
  assert_eq!(result.covered_edges, 3)
  assert_eq!(result.coverage_ratio, 1.0)
}

test "select_by_coverage: filters to changed edges only" {
  let coverages = [
    TestCoverage::{ suite: "test_a", test_name: "a", edges: ["e1", "e2", "e99", "e100"] },
    TestCoverage::{ suite: "test_b", test_name: "b", edges: ["e3", "e99"] },
  ]
  let changed = ["e1", "e2", "e3"] // e99, e100 not in changed set

  let result = select_by_coverage(coverages, changed, count=2)

  assert_eq!(result.covered_edges, 3) // only counts changed edges
  assert_eq!(result.total_changed_edges, 3)
}

test "select_by_coverage: empty inputs" {
  let result1 = select_by_coverage([], ["e1"], count=5)
  assert_eq!(result1.selected.length(), 0)

  let coverages = [
    TestCoverage::{ suite: "test_a", test_name: "a", edges: ["e1"] },
  ]
  let result2 = select_by_coverage(coverages, [], count=5)
  assert_eq!(result2.selected.length(), 0)
}

test "select_by_coverage: no test covers changed edges" {
  let coverages = [
    TestCoverage::{ suite: "test_a", test_name: "a", edges: ["e99", "e100"] },
  ]
  let changed = ["e1", "e2"]

  let result = select_by_coverage(coverages, changed, count=5)
  assert_eq!(result.selected.length(), 0)
  assert_eq!(result.covered_edges, 0)
}

test "bucketize_rate: AFL-style bucketing" {
  assert_eq!(bucketize_rate(0.0), 0)
  assert_eq!(bucketize_rate(1.0), 1)
  assert_eq!(bucketize_rate(5.0), 1)
  assert_eq!(bucketize_rate(6.0), 2)
  assert_eq!(bucketize_rate(15.0), 2)
  assert_eq!(bucketize_rate(16.0), 3)
  assert_eq!(bucketize_rate(35.0), 3)
  assert_eq!(bucketize_rate(50.0), 4)
  assert_eq!(bucketize_rate(66.0), 5)
  assert_eq!(bucketize_rate(100.0), 5)
}
