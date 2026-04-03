///|
fn normalize_variant(
  variant : Array[@types.StableVariantEntryInput]?,
) -> Array[@types.StableVariantEntryInput]? {
  match variant {
    None => None
    Some(entries) => {
      if entries.is_empty() {
        return None
      }
      let normalized = entries.copy()
      normalized.sort_by(fn(a, b) { a.key.lexical_compare(b.key) })
      Some(normalized)
    }
  }
}

///|
fn quote_json(value : String) -> String {
  value.to_json().stringify()
}

///|
fn variant_json_text(
  variant : Array[@types.StableVariantEntryInput]?,
) -> String {
  match variant {
    None => "null"
    Some(entries) => {
      if entries.is_empty() {
        return "null"
      }
      let fields = entries.map(fn(entry) {
        "\{quote_json(entry.key)}:\{quote_json(entry.value)}"
      })
      let body = fields.join(",")
      "{" + body + "}"
    }
  }
}

///|
pub fn create_stable_test_id(input : @types.StableTestIdentityInput) -> String {
  let task_id = match input.task_id {
    Some(task_id) => task_id
    None => input.suite
  }
  let filter = input.filter
  let variant = normalize_variant(input.variant)
  let filter_json = match filter {
    Some(filter) => quote_json(filter)
    None => "null"
  }
  let variant_json = variant_json_text(variant)
  let result = "{\"taskId\":" +
    quote_json(task_id) +
    ",\"suite\":" +
    quote_json(input.suite) +
    ",\"testName\":" +
    quote_json(input.test_name) +
    ",\"filter\":" +
    filter_json +
    ",\"variant\":" +
    variant_json +
    "}"
  result
}

///|
pub fn resolve_test_identity(
  input : @types.StableTestIdentityInput,
) -> @types.ResolvedStableTestIdentityOutput {
  let task_id = match input.task_id {
    Some(task_id) => task_id
    None => input.suite
  }
  let filter = input.filter
  let variant = normalize_variant(input.variant)
  let test_id = match input.test_id {
    Some(test_id) => test_id
    None =>
      create_stable_test_id(@types.StableTestIdentityInput::{
        suite: input.suite,
        test_name: input.test_name,
        task_id: Some(task_id),
        filter,
        variant,
        test_id: None,
      })
  }

  @types.ResolvedStableTestIdentityOutput::{
    suite: input.suite,
    test_name: input.test_name,
    task_id,
    filter,
    variant,
    test_id,
  }
}
