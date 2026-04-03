///|
test "dedupe_affected_targets sorts by spec task and filter" {
  let result = dedupe_affected_targets([
    @types.AffectedTargetInput::{
      spec: "tests/app.spec.ts",
      task_id: "app",
      filter: Some("@mobile"),
    },
    @types.AffectedTargetInput::{
      spec: "tests/app.spec.ts",
      task_id: "app",
      filter: Some("@mobile"),
    },
    @types.AffectedTargetInput::{
      spec: "tests/app.spec.ts",
      task_id: "app",
      filter: Some("@desktop"),
    },
    @types.AffectedTargetInput::{
      spec: "tests/core.spec.ts",
      task_id: "core",
      filter: None,
    },
  ])

  assert_eq(result, [
    @types.AffectedTargetInput::{
      spec: "tests/app.spec.ts",
      task_id: "app",
      filter: Some("@desktop"),
    },
    @types.AffectedTargetInput::{
      spec: "tests/app.spec.ts",
      task_id: "app",
      filter: Some("@mobile"),
    },
    @types.AffectedTargetInput::{
      spec: "tests/core.spec.ts",
      task_id: "core",
      filter: None,
    },
  ])
}

///|
test "build_affected_report combines direct and transitive selections" {
  let result = build_affected_report(
    [
      @types.AffectedTargetInput::{
        spec: "tests/core.spec.ts",
        task_id: "core",
        filter: None,
      },
      @types.AffectedTargetInput::{
        spec: "tests/app.spec.ts",
        task_id: "app",
        filter: Some("@desktop"),
      },
      @types.AffectedTargetInput::{
        spec: "tests/app.spec.ts",
        task_id: "app",
        filter: Some("@mobile"),
      },
    ],
    [
      @types.AffectedDirectSelectionInput::{
        spec: "tests/core.spec.ts",
        task_id: "core",
        filter: None,
        matched_paths: ["src/core/a.ts", "src/core/a.ts"],
        match_reasons: ["package:core"],
      },
    ],
    [
      @types.AffectedTransitiveTaskInput::{
        task_id: "app",
        included_by: ["core"],
        match_reasons: ["dependency:core"],
      },
    ],
    ["README.md"],
  )

  assert_eq(result.summary.matched_count, 1)
  assert_eq(result.summary.selected_count, 3)
  assert_eq(result.summary.unmatched_count, 1)
  assert_eq(result.matched.map(fn(entry) { entry.task_id }), ["core"])
  assert_eq(result.selected, [
    @types.AffectedSelectionOutput::{
      task_id: "app",
      spec: "tests/app.spec.ts",
      filter: Some("@desktop"),
      direct: false,
      included_by: ["core"],
      matched_paths: [],
      match_reasons: ["dependency:core"],
    },
    @types.AffectedSelectionOutput::{
      task_id: "app",
      spec: "tests/app.spec.ts",
      filter: Some("@mobile"),
      direct: false,
      included_by: ["core"],
      matched_paths: [],
      match_reasons: ["dependency:core"],
    },
    @types.AffectedSelectionOutput::{
      task_id: "core",
      spec: "tests/core.spec.ts",
      filter: None,
      direct: true,
      included_by: [],
      matched_paths: ["src/core/a.ts"],
      match_reasons: ["package:core"],
    },
  ])
  assert_eq(result.unmatched, ["README.md"])
}
