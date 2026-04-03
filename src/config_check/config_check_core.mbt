///|
priv struct Counter {
  mut value : Int
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
fn claim_key(task_id : String, filter : String?) -> String {
  let filter_text = match filter {
    Some(filter) => filter
    None => ""
  }
  task_id + "\n" + filter_text
}

///|
fn classify_ownership(
  claims : Array[@types.ConfigOwnershipClaimOutput],
) -> String {
  if claims.length() <= 1 {
    return "owned"
  }

  let filters : Map[String, Bool] = {}
  for claim in claims {
    match claim.filter {
      None => return "duplicate"
      Some(filter) => {
        if filters.contains(filter) {
          return "duplicate"
        }
        filters.set(filter, true)
      }
    }
  }

  "split"
}

///|
pub fn run_config_check(
  listed_tests : Array[@types.ConfigCheckListedTestInput],
  discovered_specs : Array[String],
  task_definitions : Array[@types.ConfigCheckTaskDefinitionInput],
) -> @types.ConfigCheckCoreOutput {
  let ownership_index : Map[
    String,
    Map[String, @types.ConfigOwnershipClaimOutput],
  ] = {}
  let ownership_order : Array[String] = []
  let task_specs : Map[String, Map[String, Bool]] = {}
  let task_filters : Map[String, Map[String, Bool]] = {}
  let task_test_counts : Map[String, Int] = {}
  let task_ids_seen : Map[String, Bool] = {}
  let task_ids : Array[String] = []
  let task_definitions_by_id : Map[
    String,
    @types.ConfigCheckTaskDefinitionInput,
  ] = {}

  for task in task_definitions {
    task_definitions_by_id.set(task.task_id, task)
    if !task_ids_seen.contains(task.task_id) {
      task_ids_seen.set(task.task_id, true)
      task_ids.push(task.task_id)
    }
  }

  for entry in listed_tests {
    let spec = entry.suite
    let task_id = entry.task_id
    let filter = entry.filter

    if !ownership_index.contains(spec) {
      ownership_index.set(spec, {})
      ownership_order.push(spec)
    }
    let claims_by_key = ownership_index[spec]
    let key = claim_key(task_id, filter)
    let next_count = match claims_by_key.get(key) {
      Some(existing) => existing.test_count + 1
      None => 1
    }
    claims_by_key.set(key, @types.ConfigOwnershipClaimOutput::{
      task_id,
      filter,
      test_count: next_count,
    })

    let specs = task_specs.get_or_init(task_id, fn() { {} })
    specs.set(spec, true)

    if filter is Some(filter) {
      let filters = task_filters.get_or_init(task_id, fn() { {} })
      filters.set(filter, true)
    }

    let updated_test_count = match task_test_counts.get(task_id) {
      Some(count) => count + 1
      None => 1
    }
    task_test_counts.set(task_id, updated_test_count)

    if !task_ids_seen.contains(task_id) {
      task_ids_seen.set(task_id, true)
      task_ids.push(task_id)
    }
  }

  ownership_order.sort()
  let ownership : Array[@types.ConfigOwnershipEntryOutput] = []
  let errors : Array[@types.ConfigCheckIssueOutput] = []
  let managed_specs : Map[String, Bool] = {}
  let split_count = Counter::{ value: 0 }

  for spec in ownership_order {
    managed_specs.set(spec, true)
    let owners : Array[@types.ConfigOwnershipClaimOutput] = []
    ownership_index[spec].each(fn(_, claim) { owners.push(claim) })
    owners.sort_by(fn(a, b) {
      let by_task_id = a.task_id.lexical_compare(b.task_id)
      if by_task_id != 0 {
        by_task_id
      } else {
        compare_nullable(a.filter, b.filter)
      }
    })
    let kind = classify_ownership(owners)
    if kind == "split" {
      split_count.value += 1
    }
    if kind == "duplicate" {
      let owner_detail = owners
        .map(fn(owner) {
          match owner.filter {
            Some(filter) => "\{owner.task_id} (\{filter})"
            None => owner.task_id
          }
        })
        .join(", ")
      errors.push(@types.ConfigCheckIssueOutput::{
        code: "duplicate-ownership",
        spec,
        detail: owner_detail,
      })
    }
    ownership.push(@types.ConfigOwnershipEntryOutput::{ spec, kind, owners })
  }

  let discovered_seen : Map[String, Bool] = {}
  let discovered_order : Array[String] = []
  for spec in discovered_specs {
    if !discovered_seen.contains(spec) {
      discovered_seen.set(spec, true)
      discovered_order.push(spec)
    }
  }
  discovered_order.sort()

  let warnings : Array[@types.ConfigCheckIssueOutput] = []
  for spec in discovered_order {
    if !managed_specs.contains(spec) {
      warnings.push(@types.ConfigCheckIssueOutput::{
        code: "unmanaged-spec",
        spec,
        detail: "Spec exists on disk but is not claimed by any task",
      })
    }
  }

  task_ids.sort()
  let tasks : Array[@types.ConfigTaskSummaryOutput] = []
  for task_id in task_ids {
    let definition = task_definitions_by_id.get(task_id)
    let node = match definition {
      Some(definition) => definition.node
      None => None
    }
    let needs_count = match definition {
      Some(definition) => definition.needs.length()
      None => 0
    }
    let src_count = match definition {
      Some(definition) => definition.srcs.length()
      None => 0
    }
    let spec_count = match task_specs.get(task_id) {
      Some(specs) => specs.length()
      None => 0
    }
    let filter_count = match task_filters.get(task_id) {
      Some(filters) => filters.length()
      None => 0
    }
    let test_count = match task_test_counts.get(task_id) {
      Some(count) => count
      None => 0
    }
    tasks.push(@types.ConfigTaskSummaryOutput::{
      task_id,
      node,
      spec_count,
      test_count,
      filter_count,
      needs_count,
      src_count,
    })
  }

  @types.ConfigCheckCoreOutput::{
    summary: @types.ConfigCheckSummaryOutput::{
      task_count: tasks.length(),
      spec_count: ownership.length(),
      duplicate_ownership_count: errors.length(),
      split_ownership_count: split_count.value,
      unmanaged_spec_count: warnings.length(),
      error_count: errors.length(),
      warning_count: warnings.length(),
    },
    ownership,
    tasks,
    errors,
    warnings,
  }
}
