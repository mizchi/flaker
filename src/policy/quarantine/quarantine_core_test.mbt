///|
test "summarize_quarantine validates ownership and expiry" {
  let result = summarize_quarantine(
    [
      @types.QuarantineEntryInput::{
        id: "paint-vrt-real-world-local-assets",
        task_id: "paint-vrt",
        spec: "tests/paint-vrt.test.ts",
        title_pattern: "^real-world snapshot:",
        mode: "skip",
        scope: "environment",
        owner: "mizchi",
        reason: "Optional real-world fixtures are not always present locally.",
        condition: "Skip only when the named real-world snapshot is missing from disk.",
        introduced_at: "2026-04-01",
        expires_at: "2026-04-04",
        tracking_issue: None,
      },
      @types.QuarantineEntryInput::{
        id: "missing-spec",
        task_id: "paint-vrt",
        spec: "tests/missing.test.ts",
        title_pattern: "^fixture:",
        mode: "skip",
        scope: "environment",
        owner: "mizchi",
        reason: "Broken config fixture",
        condition: "Never",
        introduced_at: "2026-04-01",
        expires_at: "2026-05-01",
        tracking_issue: None,
      },
      @types.QuarantineEntryInput::{
        id: "missing-task",
        task_id: "does-not-exist",
        spec: "tests/paint-vrt.test.ts",
        title_pattern: "[",
        mode: "skip",
        scope: "environment",
        owner: "mizchi",
        reason: "Broken config fixture",
        condition: "Never",
        introduced_at: "2026-04-01",
        expires_at: "2026-03-31",
        tracking_issue: None,
      },
    ],
    [
      @types.QuarantineTaskOwnershipInput::{
        id: "paint-vrt",
        specs: ["tests/paint-vrt.test.ts"],
      },
    ],
    ["tests/paint-vrt.test.ts"],
    "2026-04-01",
    7,
  )

  assert_eq(result.entry_count, 3)
  assert_eq(result.mode_counts.skip, 3)
  assert_eq(result.scope_counts.environment, 3)
  assert_eq(
    result.errors.map(fn(issue) { issue.code }),
    [
      "missing-spec",
      "unknown-task",
      "invalid-title-pattern",
      "invalid-expiry-range",
      "expired-quarantine",
    ],
  )
  assert_eq(
    result.warnings.map(fn(issue) { issue.code }),
    ["expires-soon"],
  )
  let entry_map : Map[String, String] = {}
  for entry in result.entries {
    entry_map.set(entry.id, entry.expiry_status)
  }
  assert_eq(entry_map["paint-vrt-real-world-local-assets"], "expires-soon")
  assert_eq(entry_map["missing-task"], "expired")
}

///|
test "find_matching_quarantine matches by task spec and title pattern" {
  let entries = [
    @types.QuarantineEntryInput::{
      id: "invalid-pattern",
      task_id: "paint-vrt",
      spec: "tests/paint-vrt.test.ts",
      title_pattern: "[",
      mode: "skip",
      scope: "environment",
      owner: "mizchi",
      reason: "broken",
      condition: "never",
      introduced_at: "2026-04-01",
      expires_at: "2026-04-30",
      tracking_issue: None,
    },
    @types.QuarantineEntryInput::{
      id: "paint-vrt-real-world-local-assets",
      task_id: "paint-vrt",
      spec: "tests/paint-vrt.test.ts",
      title_pattern: "^real-world snapshot:",
      mode: "skip",
      scope: "environment",
      owner: "mizchi",
      reason: "fixtures",
      condition: "missing asset",
      introduced_at: "2026-04-01",
      expires_at: "2026-04-30",
      tracking_issue: None,
    },
  ]

  assert_eq(
    find_matching_quarantine(
      entries,
      "paint-vrt",
      "tests/paint-vrt.test.ts",
      "real-world snapshot: a",
    ),
    1,
  )
  assert_eq(
    find_matching_quarantine(entries, "paint-vrt", "tests/paint-vrt.test.ts", "other"),
    -1,
  )
}

///|
test "is_blocking_failure ignores allow_failure quarantines" {
  assert_true(
    is_blocking_failure(
      @types.QuarantineRuntimeResultInput::{
        status: "failed",
        quarantine_mode: None,
      },
    ),
  )
  assert_false(
    is_blocking_failure(
      @types.QuarantineRuntimeResultInput::{
        status: "failed",
        quarantine_mode: Some("allow_failure"),
      },
    ),
  )
  assert_false(
    is_blocking_failure(
      @types.QuarantineRuntimeResultInput::{
        status: "flaky",
        quarantine_mode: Some("allow_failure"),
      },
    ),
  )
}

///|
test "compute_quarantine_exit_code preserves fallback for empty results" {
  assert_eq(
    compute_quarantine_exit_code([], 7),
    7,
  )
  assert_eq(
    compute_quarantine_exit_code(
      [
        @types.QuarantineRuntimeResultInput::{
          status: "failed",
          quarantine_mode: Some("allow_failure"),
        },
      ],
      1,
    ),
    0,
  )
  assert_eq(
    compute_quarantine_exit_code(
      [
        @types.QuarantineRuntimeResultInput::{
          status: "failed",
          quarantine_mode: None,
        },
      ],
      0,
    ),
    1,
  )
}
