///| Greedy set cover: select tests that maximize coverage of changed edges.
///
/// Algorithm (based on coverage-guided fuzzing's max-reduce):
/// 1. Build edge → tests reverse index
/// 2. Filter to edges in changedEdges
/// 3. Greedily pick the test covering the most uncovered changed edges
/// 4. Repeat until all changed edges are covered or count is reached
pub fn select_by_coverage(
  test_coverages : Array[TestCoverage],
  changed_edges : Array[String],
  count~ : Int,
) -> CoverageGuidedResult {
  if test_coverages.is_empty() || changed_edges.is_empty() || count <= 0 {
    return CoverageGuidedResult::{
      selected: [],
      covered_edges: 0,
      total_changed_edges: changed_edges.length(),
      coverage_ratio: 0.0,
    }
  }

  // Build set of changed edges
  let changed_set : Map[String, Bool] = {}
  for edge in changed_edges {
    changed_set.set(edge, true)
  }

  // For each test, compute which changed edges it covers
  let test_relevant_edges : Array[(String, Array[String])] = []
  for tc in test_coverages {
    let relevant : Array[String] = []
    for edge in tc.edges {
      if changed_set.contains(edge) {
        relevant.push(edge)
      }
    }
    if relevant.length() > 0 {
      test_relevant_edges.push((tc.suite, relevant))
    }
  }

  // Greedy set cover
  let selected : Array[String] = []
  let covered : Map[String, Bool] = {}
  let used_suites : Map[String, Bool] = {}

  let max_select = if count < test_relevant_edges.length() {
    count
  } else {
    test_relevant_edges.length()
  }

  for _ in 0..<max_select {
    // Find test covering most uncovered edges
    let mut best_idx = -1
    let mut best_new_count = 0

    for i in 0..<test_relevant_edges.length() {
      let entry = test_relevant_edges[i]
      let suite = entry.0
      let edges = entry.1
      if used_suites.contains(suite) {
        continue
      }
      let mut new_count = 0
      for edge in edges {
        if !covered.contains(edge) {
          new_count += 1
        }
      }
      if new_count > best_new_count {
        best_new_count = new_count
        best_idx = i
      }
    }

    if best_idx < 0 || best_new_count == 0 {
      break // No more uncovered edges can be covered
    }

    let best = test_relevant_edges[best_idx]
    selected.push(best.0)
    used_suites.set(best.0, true)
    for edge in best.1 {
      covered.set(edge, true)
    }
  }

  let covered_count = covered.size()
  let total = changed_edges.length()
  let ratio = if total > 0 {
    (covered_count.to_double() / total.to_double() * 100.0).round() / 100.0
  } else {
    1.0
  }

  CoverageGuidedResult::{
    selected,
    covered_edges: covered_count,
    total_changed_edges: total,
    coverage_ratio: ratio,
  }
}

///| Bucket a rate value (0-100) into AFL-style discrete buckets.
/// Reduces noise in flaky_rate and co_failure_boost.
///
/// | Raw     | Bucket |
/// |---------|--------|
/// | 0       | 0      |
/// | 1-5     | 1      |
/// | 6-15    | 2      |
/// | 16-35   | 3      |
/// | 36-65   | 4      |
/// | 66-100  | 5      |
pub fn bucketize_rate(rate : Double) -> Int {
  if rate <= 0.0 {
    0
  } else if rate <= 5.0 {
    1
  } else if rate <= 15.0 {
    2
  } else if rate <= 35.0 {
    3
  } else if rate <= 65.0 {
    4
  } else {
    5
  }
}
