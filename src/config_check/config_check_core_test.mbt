///|
test "run_config_check detects duplicate ownership and unmanaged specs" {
  let report = run_config_check(
    [
      @types.ConfigCheckListedTestInput::{
        suite: "tests/auth/login.spec.ts",
        task_id: "auth-login",
        filter: None,
      },
      @types.ConfigCheckListedTestInput::{
        suite: "tests/auth/login.spec.ts",
        task_id: "auth-login",
        filter: None,
      },
      @types.ConfigCheckListedTestInput::{
        suite: "tests/website-loading.spec.ts",
        task_id: "website-loading",
        filter: Some("@desktop"),
      },
      @types.ConfigCheckListedTestInput::{
        suite: "tests/website-loading.spec.ts",
        task_id: "website-loading",
        filter: Some("@mobile"),
      },
      @types.ConfigCheckListedTestInput::{
        suite: "tests/duplicate.spec.ts",
        task_id: "dup-a",
        filter: None,
      },
      @types.ConfigCheckListedTestInput::{
        suite: "tests/duplicate.spec.ts",
        task_id: "dup-b",
        filter: None,
      },
    ],
    [
      "tests/auth/login.spec.ts", "tests/website-loading.spec.ts", "tests/duplicate.spec.ts",
      "tests/unmanaged.spec.ts",
    ],
    [
      @types.ConfigCheckTaskDefinitionInput::{
        task_id: "auth-login",
        node: Some("auth"),
        needs: [],
        srcs: ["src/auth/**"],
      },
      @types.ConfigCheckTaskDefinitionInput::{
        task_id: "website-loading",
        node: Some("web"),
        needs: ["auth-login"],
        srcs: ["src/website/**", "src/shared/**"],
      },
    ],
  )

  assert_eq(report.errors, [
    @types.ConfigCheckIssueOutput::{
      code: "duplicate-ownership",
      spec: "tests/duplicate.spec.ts",
      detail: "dup-a, dup-b",
    },
  ])
  assert_eq(report.warnings, [
    @types.ConfigCheckIssueOutput::{
      code: "unmanaged-spec",
      spec: "tests/unmanaged.spec.ts",
      detail: "Spec exists on disk but is not claimed by any task",
    },
  ])
  assert_eq(report.summary, @types.ConfigCheckSummaryOutput::{
    task_count: 4,
    spec_count: 3,
    duplicate_ownership_count: 1,
    split_ownership_count: 1,
    unmanaged_spec_count: 1,
    error_count: 1,
    warning_count: 1,
  })
  assert_eq(report.ownership[2], @types.ConfigOwnershipEntryOutput::{
    spec: "tests/website-loading.spec.ts",
    kind: "split",
    owners: [
      @types.ConfigOwnershipClaimOutput::{
        task_id: "website-loading",
        filter: Some("@desktop"),
        test_count: 1,
      },
      @types.ConfigOwnershipClaimOutput::{
        task_id: "website-loading",
        filter: Some("@mobile"),
        test_count: 1,
      },
    ],
  })
  assert_eq(report.tasks[3], @types.ConfigTaskSummaryOutput::{
    task_id: "website-loading",
    node: Some("web"),
    spec_count: 1,
    test_count: 2,
    filter_count: 2,
    needs_count: 1,
    src_count: 2,
  })
}
