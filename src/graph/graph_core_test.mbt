///|
fn find_index_of(values : Array[String], target : String) -> Int {
  match values.search_by(fn(value) { value == target }) {
    Some(index) => index
    None => -1
  }
}

///|
fn make_graph() -> @types.DependencyGraphInput {
  @types.DependencyGraphInput::{
    root_dir: "/tmp",
    nodes: [
      @types.GraphNodeInput::{
        id: "core",
        path: "packages/core",
        dependencies: [],
        source_patterns: ["packages/core/src/**"],
        test_patterns: ["packages/core/tests/**"],
      },
      @types.GraphNodeInput::{
        id: "app",
        path: "packages/app",
        dependencies: ["core"],
        source_patterns: ["packages/app/src/**"],
        test_patterns: ["packages/app/tests/**"],
      },
    ],
  }
}

///|
test "find_affected_nodes expands transitive dependents" {
  let affected = find_affected_nodes(make_graph(), [
    "packages/core/src/index.ts",
  ])
  assert_true(affected.contains("core"))
  assert_true(affected.contains("app"))
}

///|
test "topological_sort keeps dependencies before dependents" {
  let order = topological_sort(make_graph())
  assert_true(find_index_of(order, "core") < find_index_of(order, "app"))
}

///|
test "get_affected_test_patterns preserves requested order" {
  let patterns = get_affected_test_patterns(make_graph(), ["app", "core"])
  assert_eq(patterns, ["packages/app/tests/**", "packages/core/tests/**"])
}
