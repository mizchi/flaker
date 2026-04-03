///|
priv struct DirectSelectionAcc {
  target : @types.AffectedTargetInput
  matched_paths : Array[String]
  match_reasons : Array[String]
}

///|
priv struct TransitiveTaskAcc {
  included_by : Array[String]
  match_reasons : Array[String]
}

///|
fn compare_nullable(a : String?, b : String?) -> Int {
  match (a, b) {
    (None, None) => 0
    (None, Some(_)) => -1
    (Some(_), None) => 1
    (Some(a), Some(b)) => a.lexical_compare(b)
  }
}

///|
fn target_key(target : @types.AffectedTargetInput) -> String {
  let filter_text = match target.filter {
    Some(filter) => filter
    None => ""
  }
  target.spec + "\n" + target.task_id + "\n" + filter_text
}

///|
fn sort_strings(values : Array[String]) -> Array[String] {
  let result = values.copy()
  result.sort_by(fn(a, b) { a.lexical_compare(b) })
  result
}

///|
fn add_unique(values : Array[String], value : String) -> Unit {
  if !values.contains(value) {
    values.push(value)
  }
}

///|
fn compare_targets(
  a : @types.AffectedTargetInput,
  b : @types.AffectedTargetInput,
) -> Int {
  let by_spec = a.spec.lexical_compare(b.spec)
  if by_spec != 0 {
    return by_spec
  }
  let by_task = a.task_id.lexical_compare(b.task_id)
  if by_task != 0 {
    return by_task
  }
  compare_nullable(a.filter, b.filter)
}

///|
fn compare_selections(
  a : @types.AffectedSelectionOutput,
  b : @types.AffectedSelectionOutput,
) -> Int {
  let by_spec = a.spec.lexical_compare(b.spec)
  if by_spec != 0 {
    return by_spec
  }
  let by_task = a.task_id.lexical_compare(b.task_id)
  if by_task != 0 {
    return by_task
  }
  compare_nullable(a.filter, b.filter)
}

///|
pub fn dedupe_affected_targets(
  targets : Array[@types.AffectedTargetInput],
) -> Array[@types.AffectedTargetInput] {
  let deduped_by_key : Map[String, @types.AffectedTargetInput] = {}
  let deduped : Array[@types.AffectedTargetInput] = []

  for target in targets {
    let key = target_key(target)
    if !deduped_by_key.contains(key) {
      deduped_by_key.set(key, target)
      deduped.push(target)
    }
  }

  deduped.sort_by(compare_targets)
  deduped
}

///|
fn freeze_direct_selection(
  acc : DirectSelectionAcc,
) -> @types.AffectedSelectionOutput {
  @types.AffectedSelectionOutput::{
    task_id: acc.target.task_id,
    spec: acc.target.spec,
    filter: acc.target.filter,
    direct: true,
    included_by: [],
    matched_paths: sort_strings(acc.matched_paths),
    match_reasons: acc.match_reasons.copy(),
  }
}

///|
fn freeze_transitive_selection(
  target : @types.AffectedTargetInput,
  acc : TransitiveTaskAcc,
) -> @types.AffectedSelectionOutput {
  @types.AffectedSelectionOutput::{
    task_id: target.task_id,
    spec: target.spec,
    filter: target.filter,
    direct: false,
    included_by: sort_strings(acc.included_by),
    matched_paths: [],
    match_reasons: acc.match_reasons.copy(),
  }
}

///|
pub fn build_affected_report(
  targets : Array[@types.AffectedTargetInput],
  direct_selections : Array[@types.AffectedDirectSelectionInput],
  transitive_tasks : Array[@types.AffectedTransitiveTaskInput],
  unmatched : Array[String],
) -> @types.AffectedReportCoreOutput {
  let sorted_targets = dedupe_affected_targets(targets)
  let direct_by_key : Map[String, DirectSelectionAcc] = {}

  for selection in direct_selections {
    let target = @types.AffectedTargetInput::{
      spec: selection.spec,
      task_id: selection.task_id,
      filter: selection.filter,
    }
    let acc = direct_by_key.get_or_init(target_key(target), fn() {
      DirectSelectionAcc::{ target, matched_paths: [], match_reasons: [] }
    })
    for matched_path in selection.matched_paths {
      add_unique(acc.matched_paths, matched_path)
    }
    for reason in selection.match_reasons {
      add_unique(acc.match_reasons, reason)
    }
  }

  let transitive_by_task : Map[String, TransitiveTaskAcc] = {}
  for task in transitive_tasks {
    let acc = transitive_by_task.get_or_init(task.task_id, fn() {
      TransitiveTaskAcc::{ included_by: [], match_reasons: [] }
    })
    for parent in task.included_by {
      add_unique(acc.included_by, parent)
    }
    for reason in task.match_reasons {
      add_unique(acc.match_reasons, reason)
    }
  }

  let direct_keys : Map[String, Bool] = {}
  let selected : Array[@types.AffectedSelectionOutput] = []
  for target in sorted_targets {
    let key = target_key(target)
    match direct_by_key.get(key) {
      Some(acc) => {
        direct_keys.set(key, true)
        selected.push(freeze_direct_selection(acc))
      }
      None => ()
    }
  }

  for target in sorted_targets {
    let key = target_key(target)
    if direct_keys.contains(key) {
      continue
    }
    match transitive_by_task.get(target.task_id) {
      Some(acc) => selected.push(freeze_transitive_selection(target, acc))
      None => ()
    }
  }

  selected.sort_by(compare_selections)
  let matched : Array[@types.AffectedSelectionOutput] = []
  for entry in selected {
    if entry.direct {
      matched.push(entry)
    }
  }

  let sorted_unmatched = unmatched.copy()
  sorted_unmatched.sort()

  @types.AffectedReportCoreOutput::{
    matched,
    selected,
    unmatched: sorted_unmatched,
    summary: @types.AffectedReportSummaryOutput::{
      matched_count: matched.length(),
      selected_count: selected.length(),
      unmatched_count: sorted_unmatched.length(),
    },
  }
}
