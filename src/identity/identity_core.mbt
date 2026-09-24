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
fn hex4(code : Int) -> String {
  let digits = "0123456789ABCDEF"
  let buf = StringBuilder::new()
  for shift in [12, 8, 4, 0] {
    buf.write_char(digits.code_unit_at((code >> shift) & 0xF).unsafe_to_char())
  }
  buf.to_string()
}

///|
/// The id text's form of a string: lone surrogates, and U+FFFD itself, become
/// U+FFFD followed by four upper-case hex digits. Well-formed and reversible,
/// so names that differ only in which lone surrogate they hold keep distinct
/// ids (#103). Strings with neither are unchanged.
fn escape_for_id(value : String) -> String {
  let len = value.length()
  let mut plain = true
  for i in 0..<len {
    let c = value.code_unit_at(i).to_int()
    if (c >= 0xD800 && c <= 0xDFFF) || c == 0xFFFD {
      plain = false
      break
    }
  }
  if plain {
    return value
  }
  let buf = StringBuilder::new()
  let mut i = 0
  while i < len {
    let c = value.code_unit_at(i).to_int()
    if c >= 0xD800 && c <= 0xDBFF && i + 1 < len {
      let d = value.code_unit_at(i + 1).to_int()
      if d >= 0xDC00 && d <= 0xDFFF {
        buf.write_char(
          Int::unsafe_to_char(0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00)),
        )
        i += 2
        continue
      }
    }
    if (c >= 0xD800 && c <= 0xDFFF) || c == 0xFFFD {
      buf.write_char('\u{FFFD}')
      buf.write_string(hex4(c))
    } else {
      buf.write_char(Int::unsafe_to_char(c))
    }
    i += 1
  }
  buf.to_string()
}

///|
fn quote_json(value : String) -> String {
  escape_for_id(value).to_json().stringify()
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
