///|
priv struct DateOnly {
  year : Int
  month : Int
  day : Int
}

///|
priv struct ModeCountsAcc {
  mut skip : Int
  mut allow_flaky : Int
  mut allow_failure : Int
}

///|
priv struct ScopeCountsAcc {
  mut environment : Int
  mut flaky : Int
  mut expected_failure : Int
}

///|
fn build_mode_counts() -> ModeCountsAcc {
  ModeCountsAcc::{ skip: 0, allow_flaky: 0, allow_failure: 0 }
}

///|
fn build_scope_counts() -> ScopeCountsAcc {
  ScopeCountsAcc::{ environment: 0, flaky: 0, expected_failure: 0 }
}

///|
fn create_issue(
  severity : String,
  code : String,
  message : String,
  task_id? : String? = None,
  spec? : String? = None,
) -> @types.QuarantineIssueOutput {
  @types.QuarantineIssueOutput::{ severity, code, message, task_id, spec }
}

///|
fn is_valid_title_pattern(pattern : String) -> Bool {
  guard (try? @string.Regex(pattern)) is Ok(_) else { return false }
  true
}

///|
fn is_leap_year(year : Int) -> Bool {
  year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

///|
fn days_in_month(year : Int, month : Int) -> Int {
  match month {
    1 | 3 | 5 | 7 | 8 | 10 | 12 => 31
    4 | 6 | 9 | 11 => 30
    2 => if is_leap_year(year) { 29 } else { 28 }
    _ => 0
  }
}

///|
fn parse_date_only(value : String) -> DateOnly? {
  guard (try? @string.Regex(
      "^([[:digit:]]{4})-([[:digit:]]{2})-([[:digit:]]{2})$",
    ))
    is Ok(regex) else {
    return None
  }
  guard regex.execute(value) is Some(m) else { return None }
  guard m.group(1) is Some(year_s) else { return None }
  guard m.group(2) is Some(month_s) else { return None }
  guard m.group(3) is Some(day_s) else { return None }
  guard (try? @string.parse_int(year_s)) is Ok(year) else { return None }
  guard (try? @string.parse_int(month_s)) is Ok(month) else { return None }
  guard (try? @string.parse_int(day_s)) is Ok(day) else { return None }
  if month < 1 || month > 12 {
    return None
  }
  let max_day = days_in_month(year, month)
  if day < 1 || day > max_day {
    return None
  }
  Some(DateOnly::{ year, month, day })
}

///|
fn days_from_civil(date : DateOnly) -> Int {
  let adjusted_year = if date.month <= 2 { date.year - 1 } else { date.year }
  let era = if adjusted_year >= 0 {
    adjusted_year / 400
  } else {
    (adjusted_year - 399) / 400
  }
  let year_of_era = adjusted_year - era * 400
  let adjusted_month = if date.month > 2 {
    date.month - 3
  } else {
    date.month + 9
  }
  let day_of_year = (153 * adjusted_month + 2) / 5 + date.day - 1
  let day_of_era = year_of_era * 365 +
    year_of_era / 4 -
    year_of_era / 100 +
    day_of_year
  era * 146097 + day_of_era
}

///|
fn classify_expiry(
  now : DateOnly,
  expires_at : DateOnly?,
  expires_soon_days : Int,
) -> (String, Int?) {
  match expires_at {
    None => ("invalid", None)
    Some(expires) => {
      let days_until_expiry = days_from_civil(expires) - days_from_civil(now)
      (
        if days_until_expiry < 0 {
          "expired"
        } else if days_until_expiry <= expires_soon_days {
          "expires-soon"
        } else {
          "active"
        },
        Some(days_until_expiry),
      )
    }
  }
}

///|
fn matches_lookup(
  entry : @types.QuarantineEntryInput,
  task_id : String,
  spec : String,
  title : String,
) -> Bool {
  if entry.task_id != task_id {
    return false
  }
  if entry.spec != spec {
    return false
  }
  guard (try? @string.Regex(entry.title_pattern)) is Ok(regex) else {
    return false
  }
  regex.execute(title) is Some(_)
}

///|
pub fn find_matching_quarantine(
  entries : Array[@types.QuarantineEntryInput],
  task_id : String,
  spec : String,
  title : String,
) -> Int {
  for i in 0..<entries.length() {
    if matches_lookup(entries[i], task_id, spec, title) {
      return i
    }
  }
  -1
}

///|
pub fn is_blocking_failure(
  result : @types.QuarantineRuntimeResultInput,
) -> Bool {
  let is_allow_failure = match result.quarantine_mode {
    Some("allow_failure") => true
    _ => false
  }
  result.status == "failed" && !is_allow_failure
}

///|
pub fn compute_quarantine_exit_code(
  results : Array[@types.QuarantineRuntimeResultInput],
  fallback_exit_code : Int,
) -> Int {
  for result in results {
    if is_blocking_failure(result) {
      return 1
    }
  }
  if results.length() == 0 {
    fallback_exit_code
  } else {
    0
  }
}

///|
pub fn summarize_quarantine(
  entries : Array[@types.QuarantineEntryInput],
  tasks : Array[@types.QuarantineTaskOwnershipInput],
  existing_specs : Array[String],
  now_date : String,
  expires_soon_days : Int,
) -> @types.QuarantineSummaryCoreOutput {
  let now = match parse_date_only(now_date) {
    Some(date) => date
    None => panic()
  }
  let task_by_id : Map[String, @types.QuarantineTaskOwnershipInput] = {}
  for task in tasks {
    task_by_id.set(task.id, task)
  }
  let existing_specs_set : Map[String, Bool] = {}
  for spec in existing_specs {
    existing_specs_set.set(spec, true)
  }
  let seen_ids : Map[String, Bool] = {}
  let resolved_entries : Array[@types.ResolvedQuarantineEntryOutput] = []
  let errors : Array[@types.QuarantineIssueOutput] = []
  let warnings : Array[@types.QuarantineIssueOutput] = []
  let mode_counts = build_mode_counts()
  let scope_counts = build_scope_counts()

  for entry in entries {
    match entry.mode {
      "skip" => mode_counts.skip += 1
      "allow_flaky" => mode_counts.allow_flaky += 1
      "allow_failure" => mode_counts.allow_failure += 1
      _ => ()
    }
    match entry.scope {
      "environment" => scope_counts.environment += 1
      "flaky" => scope_counts.flaky += 1
      "expected_failure" => scope_counts.expected_failure += 1
      _ => ()
    }

    if seen_ids.contains(entry.id) {
      errors.push(
        create_issue(
          "error",
          "duplicate-quarantine-id",
          "Duplicate quarantine id: \{entry.id}",
          task_id=Some(entry.task_id),
          spec=Some(entry.spec),
        ),
      )
    } else {
      seen_ids.set(entry.id, true)
    }

    let task = task_by_id.get(entry.task_id)
    if task is None {
      errors.push(
        create_issue(
          "error",
          "unknown-task",
          "Quarantine entry references unknown task: \{entry.task_id}",
          task_id=Some(entry.task_id),
          spec=Some(entry.spec),
        ),
      )
    }

    if !existing_specs_set.contains(entry.spec) {
      errors.push(
        create_issue(
          "error",
          "missing-spec",
          "Quarantine entry references missing spec: \{entry.spec}",
          task_id=Some(entry.task_id),
          spec=Some(entry.spec),
        ),
      )
    } else {
      match task {
        Some(task) =>
          if !task.specs.contains(entry.spec) {
            errors.push(
              create_issue(
                "error",
                "task-does-not-own-spec",
                "Task \{entry.task_id} does not own spec \{entry.spec}",
                task_id=Some(entry.task_id),
                spec=Some(entry.spec),
              ),
            )
          }
        None => ()
      }
    }

    if !is_valid_title_pattern(entry.title_pattern) {
      errors.push(
        create_issue(
          "error",
          "invalid-title-pattern",
          "Invalid title pattern for quarantine \{entry.id}: \{entry.title_pattern}",
          task_id=Some(entry.task_id),
          spec=Some(entry.spec),
        ),
      )
    }

    let introduced_at = parse_date_only(entry.introduced_at)
    if introduced_at is None {
      errors.push(
        create_issue(
          "error",
          "invalid-introduced-at",
          "Invalid introducedAt for quarantine \{entry.id}: \{entry.introduced_at}",
          task_id=Some(entry.task_id),
          spec=Some(entry.spec),
        ),
      )
    }

    let expires_at = parse_date_only(entry.expires_at)
    if expires_at is None {
      errors.push(
        create_issue(
          "error",
          "invalid-expires-at",
          "Invalid expiresAt for quarantine \{entry.id}: \{entry.expires_at}",
          task_id=Some(entry.task_id),
          spec=Some(entry.spec),
        ),
      )
    }

    match (introduced_at, expires_at) {
      (Some(introduced), Some(expires)) =>
        if days_from_civil(introduced) > days_from_civil(expires) {
          errors.push(
            create_issue(
              "error",
              "invalid-expiry-range",
              "introducedAt must be on or before expiresAt for quarantine \{entry.id}",
              task_id=Some(entry.task_id),
              spec=Some(entry.spec),
            ),
          )
        }
      _ => ()
    }

    let (expiry_status, days_until_expiry) = classify_expiry(
      now, expires_at, expires_soon_days,
    )
    if expiry_status == "expired" {
      errors.push(
        create_issue(
          "error",
          "expired-quarantine",
          "Quarantine \{entry.id} expired on \{entry.expires_at}",
          task_id=Some(entry.task_id),
          spec=Some(entry.spec),
        ),
      )
    } else if expiry_status == "expires-soon" {
      warnings.push(
        create_issue(
          "warning",
          "expires-soon",
          "Quarantine \{entry.id} expires on \{entry.expires_at}",
          task_id=Some(entry.task_id),
          spec=Some(entry.spec),
        ),
      )
    }

    resolved_entries.push(@types.ResolvedQuarantineEntryOutput::{
      id: entry.id,
      task_id: entry.task_id,
      spec: entry.spec,
      title_pattern: entry.title_pattern,
      mode: entry.mode,
      scope: entry.scope,
      owner: entry.owner,
      reason: entry.reason,
      condition: entry.condition,
      introduced_at: entry.introduced_at,
      expires_at: entry.expires_at,
      tracking_issue: entry.tracking_issue,
      expiry_status,
      days_until_expiry,
    })
  }

  resolved_entries.sort_by(fn(a, b) { a.id.lexical_compare(b.id) })

  @types.QuarantineSummaryCoreOutput::{
    entry_count: entries.length(),
    mode_counts: @types.QuarantineModeCountsOutput::{
      skip: mode_counts.skip,
      allow_flaky: mode_counts.allow_flaky,
      allow_failure: mode_counts.allow_failure,
    },
    scope_counts: @types.QuarantineScopeCountsOutput::{
      environment: scope_counts.environment,
      flaky: scope_counts.flaky,
      expected_failure: scope_counts.expected_failure,
    },
    entries: resolved_entries,
    errors,
    warnings,
  }
}
