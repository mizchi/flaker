///| Coverage data for a single test: which code edges it covers.
pub(all) struct TestCoverage {
  suite : String
  test_name : String
  /// Edge IDs this test covers (e.g. "src/auth.ts:42", "src/auth.ts:55")
  edges : Array[String]
} derive(Eq, Show, FromJson, ToJson)

///| Result of coverage-guided sampling.
pub(all) struct CoverageGuidedResult {
  /// Tests selected by greedy set cover (cover changed edges)
  selected : Array[String]  // suite names
  /// Edges covered by selected tests
  covered_edges : Int
  /// Total changed edges
  total_changed_edges : Int
  /// Coverage ratio of changed edges
  coverage_ratio : Double
} derive(Eq, Show, FromJson, ToJson)
