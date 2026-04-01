///|
// Language-core evaluator for the Python/Starlark expression subset.
// Host-specific workflow call lowering is implemented in semantics.mbt.

///|
fn resolve_add(
  left : StarlarkValue,
  right : StarlarkValue,
  line : Int,
  column : Int,
  errors : Array[String],
) -> StarlarkValue? {
  match (left, right) {
    (Num(lhs), Num(rhs)) => Some(Num(lhs + rhs))
    (Str(lhs), Str(rhs)) => Some(Str(lhs + rhs))
    (List(lhs), List(rhs)) => {
      let merged : Array[StarlarkValue] = []
      for item in lhs {
        merged.push(item)
      }
      for item in rhs {
        merged.push(item)
      }
      Some(List(merged))
    }
    _ => {
      semantic_error(
        errors, line, column, "'+' requires both operands to be int, string, or list",
      )
      None
    }
  }
}

///|
fn resolve_sub(
  left : StarlarkValue,
  right : StarlarkValue,
  line : Int,
  column : Int,
  errors : Array[String],
) -> StarlarkValue? {
  match (left, right) {
    (Num(lhs), Num(rhs)) => Some(Num(lhs - rhs))
    _ => {
      semantic_error(errors, line, column, "'-' requires int operands")
      None
    }
  }
}

///|
fn repeat_string(text : String, count : Int) -> String {
  if count <= 0 {
    return ""
  }
  let mut out = ""
  for _ in 0..<count {
    out = out + text
  }
  out
}

///|
fn repeat_list(
  items : Array[StarlarkValue],
  count : Int,
) -> Array[StarlarkValue] {
  let repeated : Array[StarlarkValue] = []
  if count <= 0 {
    return repeated
  }
  for _ in 0..<count {
    for item in items {
      repeated.push(item)
    }
  }
  repeated
}

///|
fn resolve_mul(
  left : StarlarkValue,
  right : StarlarkValue,
  line : Int,
  column : Int,
  errors : Array[String],
) -> StarlarkValue? {
  match (left, right) {
    (Num(lhs), Num(rhs)) => Some(Num(lhs * rhs))
    (Str(text), Num(count)) => Some(Str(repeat_string(text, count)))
    (Num(count), Str(text)) => Some(Str(repeat_string(text, count)))
    (List(items), Num(count)) => Some(List(repeat_list(items, count)))
    (Num(count), List(items)) => Some(List(repeat_list(items, count)))
    _ => {
      semantic_error(
        errors, line, column, "'*' requires int*int or (string/list)*int",
      )
      None
    }
  }
}

///|
fn resolve_floor_div(
  left : StarlarkValue,
  right : StarlarkValue,
  line : Int,
  column : Int,
  errors : Array[String],
) -> StarlarkValue? {
  match (left, right) {
    (Num(_), Num(0)) => {
      semantic_error(errors, line, column, "integer division by zero")
      None
    }
    (Num(lhs), Num(rhs)) => Some(Num(lhs / rhs))
    _ => {
      semantic_error(errors, line, column, "'//' requires int operands")
      None
    }
  }
}

///|
fn resolve_mod(
  left : StarlarkValue,
  right : StarlarkValue,
  line : Int,
  column : Int,
  errors : Array[String],
) -> StarlarkValue? {
  match (left, right) {
    (Num(_), Num(0)) => {
      semantic_error(errors, line, column, "integer modulo by zero")
      None
    }
    (Num(lhs), Num(rhs)) => Some(Num(lhs % rhs))
    _ => {
      semantic_error(errors, line, column, "'%' requires int operands")
      None
    }
  }
}

///|
fn resolve_min_max_args(
  fn_name : String,
  args : Array[StarlarkValue],
  line : Int,
  column : Int,
  errors : Array[String],
) -> Array[Int]? {
  if args.length() == 0 {
    semantic_error(
      errors,
      line,
      column,
      "\{fn_name}() expects at least 1 argument",
    )
    return None
  }

  let out : Array[Int] = []
  if args.length() == 1 {
    match args[0] {
      Num(value) => {
        out.push(value)
        return Some(out)
      }
      List(items) => {
        if items.length() == 0 {
          semantic_error(
            errors,
            line,
            column,
            "\{fn_name}() arg list must not be empty",
          )
          return None
        }
        for item in items {
          match item {
            Num(value) => out.push(value)
            _ => {
              semantic_error(
                errors,
                line,
                column,
                "\{fn_name}() expects int arguments or [int]",
              )
              return None
            }
          }
        }
        return Some(out)
      }
      _ => {
        semantic_error(
          errors,
          line,
          column,
          "\{fn_name}() expects int arguments or [int]",
        )
        return None
      }
    }
  }

  for item in args {
    match item {
      Num(value) => out.push(value)
      _ => {
        semantic_error(
          errors,
          line,
          column,
          "\{fn_name}() expects int arguments or [int]",
        )
        return None
      }
    }
  }
  Some(out)
}

///|
fn resolve_sum_product_args(
  fn_name : String,
  args : Array[StarlarkValue],
  line : Int,
  column : Int,
  errors : Array[String],
) -> Array[Int]? {
  if args.length() == 0 {
    semantic_error(
      errors,
      line,
      column,
      "\{fn_name}() expects at least 1 argument",
    )
    return None
  }

  let out : Array[Int] = []
  if args.length() == 1 {
    match args[0] {
      Num(value) => {
        out.push(value)
        return Some(out)
      }
      List(items) => {
        for item in items {
          match item {
            Num(value) => out.push(value)
            _ => {
              semantic_error(
                errors,
                line,
                column,
                "\{fn_name}() expects int arguments or [int]",
              )
              return None
            }
          }
        }
        return Some(out)
      }
      _ => {
        semantic_error(
          errors,
          line,
          column,
          "\{fn_name}() expects int arguments or [int]",
        )
        return None
      }
    }
  }

  for item in args {
    match item {
      Num(value) => out.push(value)
      _ => {
        semantic_error(
          errors,
          line,
          column,
          "\{fn_name}() expects int arguments or [int]",
        )
        return None
      }
    }
  }
  Some(out)
}

///|
fn resolve_neg(
  value : StarlarkValue,
  line : Int,
  column : Int,
  errors : Array[String],
) -> StarlarkValue? {
  match value {
    Num(num) => Some(Num(-num))
    _ => {
      semantic_error(errors, line, column, "'-' requires int operand")
      None
    }
  }
}

///|
fn normalize_index(raw : Int, length : Int) -> Int {
  if raw < 0 {
    raw + length
  } else {
    raw
  }
}

///|
fn resolve_index(
  target : StarlarkValue,
  index : StarlarkValue,
  line : Int,
  column : Int,
  errors : Array[String],
) -> StarlarkValue? {
  match target {
    List(items) =>
      match index {
        Num(raw) => {
          let idx = normalize_index(raw, items.length())
          if idx < 0 || idx >= items.length() {
            semantic_error(errors, line, column, "list index out of range")
            None
          } else {
            Some(items[idx])
          }
        }
        _ => {
          semantic_error(errors, line, column, "list index must be int")
          None
        }
      }
    Dict(entries) =>
      match index {
        Str(key) =>
          match entries.get(key) {
            Some(value) => Some(value)
            None => {
              semantic_error(errors, line, column, "dict key not found: \{key}")
              None
            }
          }
        _ => {
          semantic_error(errors, line, column, "dict index must be string")
          None
        }
      }
    Str(text) =>
      match index {
        Num(raw) => {
          let idx = normalize_index(raw, text.length())
          if idx < 0 || idx >= text.length() {
            semantic_error(errors, line, column, "string index out of range")
            None
          } else {
            let ch = String::unsafe_substring(text, start=idx, end=idx + 1)
            Some(Str(ch))
          }
        }
        _ => {
          semantic_error(errors, line, column, "string index must be int")
          None
        }
      }
    _ => {
      semantic_error(
        errors, line, column, "indexing is only supported for list, dict, and string",
      )
      None
    }
  }
}

///|
fn resolve_slice_step(
  step : StarlarkValue?,
  line : Int,
  column : Int,
  errors : Array[String],
) -> Int? {
  match step {
    None => Some(1)
    Some(Num(value)) =>
      if value == 0 {
        semantic_error(errors, line, column, "slice step cannot be 0")
        None
      } else {
        Some(value)
      }
    Some(_) => {
      semantic_error(errors, line, column, "slice step must be int")
      None
    }
  }
}

///|
fn resolve_slice_bound_with_step(
  bound : StarlarkValue?,
  default_positive : Int,
  default_negative : Int,
  label : String,
  length : Int,
  step : Int,
  line : Int,
  column : Int,
  errors : Array[String],
) -> Int? {
  let mut index = match bound {
    None => if step > 0 { default_positive } else { default_negative }
    Some(Num(raw)) => {
      let mut normalized = raw
      if normalized < 0 {
        normalized += length
      }
      normalized
    }
    Some(_) => {
      semantic_error(errors, line, column, label + " must be int")
      return None
    }
  }
  if step > 0 {
    if index < 0 {
      index = 0
    }
    if index > length {
      index = length
    }
  } else {
    if index < -1 {
      index = -1
    }
    if index >= length {
      index = length - 1
    }
  }
  Some(index)
}

///|
fn resolve_slice(
  target : StarlarkValue,
  start : StarlarkValue?,
  end : StarlarkValue?,
  step : StarlarkValue?,
  line : Int,
  column : Int,
  errors : Array[String],
) -> StarlarkValue? {
  let step_value = match resolve_slice_step(step, line, column, errors) {
    Some(value) => value
    None => return None
  }
  match target {
    List(items) => {
      let len = items.length()
      let start_idx = match
        resolve_slice_bound_with_step(
          start,
          0,
          len - 1,
          "slice start",
          len,
          step_value,
          line,
          column,
          errors,
        ) {
        Some(v) => v
        None => return None
      }
      let end_idx = match
        resolve_slice_bound_with_step(
          end, len, -1, "slice end", len, step_value, line, column, errors,
        ) {
        Some(v) => v
        None => return None
      }
      let result : Array[StarlarkValue] = []
      let mut idx = start_idx
      if step_value > 0 {
        while idx < end_idx {
          result.push(items[idx])
          idx += step_value
        }
      } else {
        while idx > end_idx {
          result.push(items[idx])
          idx += step_value
        }
      }
      Some(List(result))
    }
    Str(text) => {
      let len = text.length()
      let start_idx = match
        resolve_slice_bound_with_step(
          start,
          0,
          len - 1,
          "slice start",
          len,
          step_value,
          line,
          column,
          errors,
        ) {
        Some(v) => v
        None => return None
      }
      let end_idx = match
        resolve_slice_bound_with_step(
          end, len, -1, "slice end", len, step_value, line, column, errors,
        ) {
        Some(v) => v
        None => return None
      }
      let parts : Array[String] = []
      let mut idx = start_idx
      if step_value > 0 {
        while idx < end_idx {
          parts.push(String::unsafe_substring(text, start=idx, end=idx + 1))
          idx += step_value
        }
      } else {
        while idx > end_idx {
          parts.push(String::unsafe_substring(text, start=idx, end=idx + 1))
          idx += step_value
        }
      }
      Some(Str(parts.join("")))
    }
    _ => {
      semantic_error(
        errors, line, column, "slicing is only supported for list and string",
      )
      None
    }
  }
}

///|
fn find_substring_from(text : String, needle : String, start : Int) -> Int? {
  let text_len = text.length()
  let needle_len = needle.length()
  if needle_len == 0 {
    return Some(start)
  }
  if start < 0 {
    return None
  }
  if start + needle_len > text_len {
    return None
  }
  let limit = text_len - needle_len
  let mut idx = start
  while idx <= limit {
    let candidate = String::unsafe_substring(
      text,
      start=idx,
      end=idx + needle_len,
    )
    if candidate == needle {
      return Some(idx)
    }
    idx += 1
  }
  None
}

///|
fn replace_with_limit(
  text : String,
  old : String,
  new_value : String,
  max_count : Int,
) -> String {
  let old_len = old.length()
  let text_len = text.length()
  let mut out = ""
  let mut cursor = 0
  let mut replaced = 0
  while true {
    if max_count >= 0 && replaced >= max_count {
      break
    }
    match find_substring_from(text, old, cursor) {
      Some(next_idx) => {
        out = out + String::unsafe_substring(text, start=cursor, end=next_idx)
        out = out + new_value
        cursor = next_idx + old_len
        replaced += 1
      }
      None => break
    }
  }
  out + String::unsafe_substring(text, start=cursor, end=text_len)
}

///|
fn char_in_text(text : String, target : UInt16) -> Bool {
  let mut idx = 0
  while idx < text.length() {
    if text.unsafe_get(idx) == target {
      return true
    }
    idx += 1
  }
  false
}

///|
fn strip_with_chars(
  text : String,
  chars : String,
  trim_left : Bool,
  trim_right : Bool,
) -> String {
  let mut start = 0
  let mut end = text.length()
  if trim_left {
    while start < end && char_in_text(chars, text.unsafe_get(start)) {
      start += 1
    }
  }
  if trim_right {
    while end > start && char_in_text(chars, text.unsafe_get(end - 1)) {
      end -= 1
    }
  }
  if start == 0 && end == text.length() {
    text
  } else {
    String::unsafe_substring(text, start~, end~)
  }
}

///|
fn resolve_method_call(
  receiver : StarlarkValue,
  name : String,
  args : Array[StarlarkValue],
  line : Int,
  column : Int,
  errors : Array[String],
) -> StarlarkValue? {
  match receiver {
    Str(text) => {
      if name == "lower" {
        if args.length() != 0 {
          semantic_error(
            errors, line, column, "lower() expects exactly 0 arguments",
          )
          return None
        }
        return Some(Str(text.to_lower()))
      }
      if name == "upper" {
        if args.length() != 0 {
          semantic_error(
            errors, line, column, "upper() expects exactly 0 arguments",
          )
          return None
        }
        return Some(Str(text.to_upper()))
      }
      if name == "replace" {
        if args.length() < 2 || args.length() > 3 {
          semantic_error(
            errors, line, column, "replace() expects 2 or 3 arguments",
          )
          return None
        }
        let old = match args[0] {
          Str(value) => value
          _ => {
            semantic_error(
              errors, line, column, "replace() expects string old/new arguments",
            )
            return None
          }
        }
        let new_value = match args[1] {
          Str(value) => value
          _ => {
            semantic_error(
              errors, line, column, "replace() expects string old/new arguments",
            )
            return None
          }
        }
        if old.length() == 0 {
          semantic_error(
            errors, line, column, "replace() old must not be empty",
          )
          return None
        }
        let max_count = if args.length() == 3 {
          match args[2] {
            Num(count) =>
              if count >= 0 {
                count
              } else {
                semantic_error(
                  errors, line, column, "replace() count must be non-negative int",
                )
                return None
              }
            _ => {
              semantic_error(
                errors, line, column, "replace() count must be non-negative int",
              )
              return None
            }
          }
        } else {
          -1
        }
        return Some(Str(replace_with_limit(text, old, new_value, max_count)))
      }
      if name == "strip" {
        if args.length() > 1 {
          semantic_error(
            errors, line, column, "strip() expects 0 or 1 arguments",
          )
          return None
        }
        if args.length() == 0 {
          return Some(Str(trim_ascii_space(text)))
        }
        match args[0] {
          Str(chars) =>
            return Some(Str(strip_with_chars(text, chars, true, true)))
          _ => {
            semantic_error(
              errors, line, column, "strip() expects string argument when provided",
            )
            return None
          }
        }
      }
      if name == "lstrip" {
        if args.length() > 1 {
          semantic_error(
            errors, line, column, "lstrip() expects 0 or 1 arguments",
          )
          return None
        }
        if args.length() == 0 {
          return Some(Str(strip_with_chars(text, " \t\n\r", true, false)))
        }
        match args[0] {
          Str(chars) =>
            return Some(Str(strip_with_chars(text, chars, true, false)))
          _ => {
            semantic_error(
              errors, line, column, "lstrip() expects string argument when provided",
            )
            return None
          }
        }
      }
      if name == "rstrip" {
        if args.length() > 1 {
          semantic_error(
            errors, line, column, "rstrip() expects 0 or 1 arguments",
          )
          return None
        }
        if args.length() == 0 {
          return Some(Str(strip_with_chars(text, " \t\n\r", false, true)))
        }
        match args[0] {
          Str(chars) =>
            return Some(Str(strip_with_chars(text, chars, false, true)))
          _ => {
            semantic_error(
              errors, line, column, "rstrip() expects string argument when provided",
            )
            return None
          }
        }
      }
      if name == "startswith" {
        if args.length() != 1 {
          semantic_error(
            errors, line, column, "startswith() expects exactly 1 argument",
          )
          return None
        }
        match args[0] {
          Str(prefix) => return Some(Bool(text.has_prefix(prefix)))
          _ => {
            semantic_error(
              errors, line, column, "startswith() expects string argument",
            )
            return None
          }
        }
      }
      if name == "endswith" {
        if args.length() != 1 {
          semantic_error(
            errors, line, column, "endswith() expects exactly 1 argument",
          )
          return None
        }
        match args[0] {
          Str(suffix) => return Some(Bool(text.has_suffix(suffix)))
          _ => {
            semantic_error(
              errors, line, column, "endswith() expects string argument",
            )
            return None
          }
        }
      }
      if name == "split" {
        if args.length() != 1 {
          semantic_error(
            errors, line, column, "split() expects exactly 1 argument",
          )
          return None
        }
        match args[0] {
          Str(sep) => {
            let out : Array[StarlarkValue] = []
            for view in text.split(sep) {
              out.push(Str(view.to_string()))
            }
            return Some(List(out))
          }
          _ => {
            semantic_error(
              errors, line, column, "split() expects string argument",
            )
            return None
          }
        }
      }
      if name == "join" {
        if args.length() != 1 {
          semantic_error(
            errors, line, column, "join() expects exactly 1 argument for string receiver",
          )
          return None
        }
        match args[0] {
          List(items) => {
            let parts : Array[String] = []
            for item in items {
              match item {
                Str(value) => parts.push(value)
                _ => {
                  semantic_error(
                    errors, line, column, "join() expects string list argument",
                  )
                  return None
                }
              }
            }
            return Some(Str(parts.join(text)))
          }
          _ => {
            semantic_error(
              errors, line, column, "join() expects string list argument",
            )
            return None
          }
        }
      }
      semantic_error(errors, line, column, "unknown string method: \{name}")
      None
    }
    Dict(entries) =>
      if name == "get" {
        if args.length() < 1 || args.length() > 2 {
          semantic_error(
            errors, line, column, "get() expects 1 or 2 arguments for dict receiver",
          )
          return None
        }
        match args[0] {
          Str(key) =>
            match entries.get(key) {
              Some(value) => Some(value)
              None =>
                if args.length() == 2 {
                  Some(args[1])
                } else {
                  Some(NoneValue)
                }
            }
          _ => {
            semantic_error(errors, line, column, "get() key must be string")
            None
          }
        }
      } else if name == "keys" {
        if args.length() != 0 {
          semantic_error(
            errors, line, column, "keys() expects exactly 0 arguments for dict receiver",
          )
          return None
        }
        let out : Array[StarlarkValue] = []
        for key, _ in entries {
          out.push(Str(key))
        }
        Some(List(out))
      } else if name == "values" {
        if args.length() != 0 {
          semantic_error(
            errors, line, column, "values() expects exactly 0 arguments for dict receiver",
          )
          return None
        }
        let out : Array[StarlarkValue] = []
        for _, value in entries {
          out.push(value)
        }
        Some(List(out))
      } else {
        semantic_error(errors, line, column, "unknown dict method: \{name}")
        None
      }
    List(items) =>
      if name == "count" {
        if args.length() != 1 {
          semantic_error(
            errors, line, column, "count() expects exactly 1 argument for list receiver",
          )
          return None
        }
        let target = args[0]
        let mut count = 0
        for item in items {
          if value_equals(item, target) {
            count += 1
          }
        }
        Some(Num(count))
      } else {
        semantic_error(errors, line, column, "unknown list method: \{name}")
        None
      }
    _ => {
      semantic_error(
        errors, line, column, "method call receiver must be string, list, or dict",
      )
      None
    }
  }
}

///|
fn iterable_items_for_expr_helper(
  fn_name : String,
  value : StarlarkValue,
  line : Int,
  column : Int,
  errors : Array[String],
) -> Array[StarlarkValue]? {
  match value {
    List(items) => Some(items)
    Dict(entries) => {
      let items : Array[StarlarkValue] = []
      for key, _ in entries {
        items.push(Str(key))
      }
      Some(items)
    }
    Str(text) => {
      let items : Array[StarlarkValue] = []
      for i in 0..<text.length() {
        items.push(Str(String::unsafe_substring(text, start=i, end=i + 1)))
      }
      Some(items)
    }
    _ => {
      semantic_error(
        errors,
        line,
        column,
        "\{fn_name}() expects iterable (string, list, or dict)",
      )
      None
    }
  }
}

///|
fn resolve_expr_call(
  name : String,
  args : Array[StarlarkValue],
  line : Int,
  column : Int,
  errors : Array[String],
) -> StarlarkValue? {
  if name == "range" {
    if args.length() < 1 || args.length() > 3 {
      semantic_error(
        errors, line, column, "range() expects 1 to 3 integer arguments",
      )
      return None
    }
    let (start, stop, step) = if args.length() == 1 {
      match args[0] {
        Num(stop) => (0, stop, 1)
        _ => {
          semantic_error(errors, line, column, "range() arguments must be int")
          return None
        }
      }
    } else if args.length() == 2 {
      match (args[0], args[1]) {
        (Num(start), Num(stop)) => (start, stop, 1)
        _ => {
          semantic_error(errors, line, column, "range() arguments must be int")
          return None
        }
      }
    } else {
      match (args[0], args[1], args[2]) {
        (Num(start), Num(stop), Num(step)) => (start, stop, step)
        _ => {
          semantic_error(errors, line, column, "range() arguments must be int")
          return None
        }
      }
    }
    if step == 0 {
      semantic_error(errors, line, column, "range() step cannot be 0")
      return None
    }
    let out : Array[StarlarkValue] = []
    let mut current = start
    if step > 0 {
      while current < stop {
        out.push(Num(current))
        current += step
      }
    } else {
      while current > stop {
        out.push(Num(current))
        current += step
      }
    }
    Some(List(out))
  } else if name == "enumerate" {
    if args.length() != 1 {
      semantic_error(
        errors, line, column, "enumerate() expects exactly 1 argument",
      )
      return None
    }
    match iterable_items_for_expr_helper(name, args[0], line, column, errors) {
      Some(items) => {
        let out : Array[StarlarkValue] = []
        let mut idx = 0
        for item in items {
          out.push(List([Num(idx), item]))
          idx += 1
        }
        Some(List(out))
      }
      None => None
    }
  } else if name == "zip" {
    if args.length() < 2 {
      semantic_error(
        errors, line, column, "zip() expects at least 2 iterable arguments",
      )
      return None
    }
    let sequences : Array[Array[StarlarkValue]] = []
    for value in args {
      match iterable_items_for_expr_helper(name, value, line, column, errors) {
        Some(items) => sequences.push(items)
        None => return None
      }
    }
    let mut min_len = sequences[0].length()
    for items in sequences {
      if items.length() < min_len {
        min_len = items.length()
      }
    }
    let out : Array[StarlarkValue] = []
    for i in 0..<min_len {
      let row : Array[StarlarkValue] = []
      for items in sequences {
        row.push(items[i])
      }
      out.push(List(row))
    }
    Some(List(out))
  } else if name == "str" {
    if args.length() != 1 {
      semantic_error(errors, line, column, "str() expects exactly 1 argument")
      return None
    }
    match args[0] {
      Str(text) => Some(Str(text))
      Num(num) => Some(Str(num.to_string()))
      Bool(flag) => Some(Str(if flag { "True" } else { "False" }))
      NoneValue => Some(Str("None"))
      _ => {
        semantic_error(
          errors, line, column, "str() expects string, int, bool, or None",
        )
        None
      }
    }
  } else if name == "int" {
    if args.length() != 1 {
      semantic_error(errors, line, column, "int() expects exactly 1 argument")
      return None
    }
    match args[0] {
      Num(num) => Some(Num(num))
      Bool(flag) => Some(Num(if flag { 1 } else { 0 }))
      Str(text) =>
        match parse_external_int(text) {
          Some(num) => Some(Num(num))
          None => {
            semantic_error(errors, line, column, "int() expects numeric string")
            None
          }
        }
      _ => {
        semantic_error(
          errors, line, column, "int() expects string, int, or bool",
        )
        None
      }
    }
  } else if name == "len" {
    if args.length() != 1 {
      semantic_error(errors, line, column, "len() expects exactly 1 argument")
      return None
    }
    match args[0] {
      Str(text) => Some(Num(text.length()))
      List(items) => Some(Num(items.length()))
      Dict(entries) => Some(Num(entries.length()))
      _ => {
        semantic_error(
          errors, line, column, "len() expects string, list, or dict",
        )
        None
      }
    }
  } else if name == "keys" {
    if args.length() != 1 {
      semantic_error(errors, line, column, "keys() expects exactly 1 argument")
      return None
    }
    match args[0] {
      Dict(entries) => {
        let out : Array[StarlarkValue] = []
        for key, _ in entries {
          out.push(Str(key))
        }
        Some(List(out))
      }
      _ => {
        semantic_error(errors, line, column, "keys() expects dict")
        None
      }
    }
  } else if name == "values" {
    if args.length() != 1 {
      semantic_error(
        errors, line, column, "values() expects exactly 1 argument",
      )
      return None
    }
    match args[0] {
      Dict(entries) => {
        let out : Array[StarlarkValue] = []
        for _, value in entries {
          out.push(value)
        }
        Some(List(out))
      }
      _ => {
        semantic_error(errors, line, column, "values() expects dict")
        None
      }
    }
  } else if name == "contains" {
    if args.length() != 2 {
      semantic_error(
        errors, line, column, "contains() expects exactly 2 arguments",
      )
      return None
    }
    let container = args[0]
    let item = args[1]
    match container {
      Str(text) =>
        match item {
          Str(sub) => Some(Bool(text.contains(sub)))
          _ => {
            semantic_error(
              errors, line, column, "contains() second argument must be string when first is string",
            )
            None
          }
        }
      List(items) => {
        for elem in items {
          if value_equals(elem, item) {
            return Some(Bool(true))
          }
        }
        Some(Bool(false))
      }
      Dict(entries) =>
        match item {
          Str(key) => Some(Bool(entries.get(key) is Some(_)))
          _ => {
            semantic_error(
              errors, line, column, "contains() second argument must be string when first is dict",
            )
            None
          }
        }
      _ => {
        semantic_error(
          errors, line, column, "contains() first argument must be string, list, or dict",
        )
        None
      }
    }
  } else if name == "all" {
    if args.length() != 1 {
      semantic_error(errors, line, column, "all() expects exactly 1 argument")
      return None
    }
    match args[0] {
      List(items) => {
        for item in items {
          if not(value_truthy(item)) {
            return Some(Bool(false))
          }
        }
        Some(Bool(true))
      }
      Dict(entries) => {
        for key, _ in entries {
          if not(value_truthy(Str(key))) {
            return Some(Bool(false))
          }
        }
        Some(Bool(true))
      }
      Str(_) => Some(Bool(true))
      _ => {
        semantic_error(
          errors, line, column, "all() expects string, list, or dict",
        )
        None
      }
    }
  } else if name == "any" {
    if args.length() != 1 {
      semantic_error(errors, line, column, "any() expects exactly 1 argument")
      return None
    }
    match args[0] {
      List(items) => {
        for item in items {
          if value_truthy(item) {
            return Some(Bool(true))
          }
        }
        Some(Bool(false))
      }
      Dict(entries) => {
        for key, _ in entries {
          if value_truthy(Str(key)) {
            return Some(Bool(true))
          }
        }
        Some(Bool(false))
      }
      Str(text) => Some(Bool(text.length() > 0))
      _ => {
        semantic_error(
          errors, line, column, "any() expects string, list, or dict",
        )
        None
      }
    }
  } else if name == "split" {
    if args.length() != 2 {
      semantic_error(
        errors, line, column, "split() expects exactly 2 arguments",
      )
      return None
    }
    match (args[0], args[1]) {
      (Str(text), Str(sep)) => {
        let out : Array[StarlarkValue] = []
        for view in text.split(sep) {
          out.push(Str(view.to_string()))
        }
        Some(List(out))
      }
      _ => {
        semantic_error(errors, line, column, "split() expects string arguments")
        None
      }
    }
  } else if name == "join" {
    if args.length() != 2 {
      semantic_error(errors, line, column, "join() expects exactly 2 arguments")
      return None
    }
    match (args[0], args[1]) {
      (List(items), Str(sep)) => {
        let parts : Array[String] = []
        for item in items {
          match item {
            Str(text) => parts.push(text)
            _ => {
              semantic_error(
                errors, line, column, "join() items must be string list",
              )
              return None
            }
          }
        }
        Some(Str(parts.join(sep)))
      }
      _ => {
        semantic_error(errors, line, column, "join() expects (list, string)")
        None
      }
    }
  } else if name == "min" {
    match resolve_min_max_args("min", args, line, column, errors) {
      Some(values) => {
        let mut best = values[0]
        for value in values {
          if value < best {
            best = value
          }
        }
        Some(Num(best))
      }
      None => None
    }
  } else if name == "max" {
    match resolve_min_max_args("max", args, line, column, errors) {
      Some(values) => {
        let mut best = values[0]
        for value in values {
          if value > best {
            best = value
          }
        }
        Some(Num(best))
      }
      None => None
    }
  } else if name == "sum" {
    match resolve_sum_product_args("sum", args, line, column, errors) {
      Some(values) => {
        let mut total = 0
        for value in values {
          total = total + value
        }
        Some(Num(total))
      }
      None => None
    }
  } else if name == "product" {
    match resolve_sum_product_args("product", args, line, column, errors) {
      Some(values) => {
        let mut total = 1
        for value in values {
          total = total * value
        }
        Some(Num(total))
      }
      None => None
    }
  } else if name == "abs" {
    if args.length() != 1 {
      semantic_error(errors, line, column, "abs() expects exactly 1 argument")
      return None
    }
    match args[0] {
      Num(value) => Some(Num(if value < 0 { -value } else { value }))
      _ => {
        semantic_error(errors, line, column, "abs() expects int argument")
        None
      }
    }
  } else if name == "clamp" {
    if args.length() != 3 {
      semantic_error(
        errors, line, column, "clamp() expects exactly 3 arguments",
      )
      return None
    }
    match (args[0], args[1], args[2]) {
      (Num(value), Num(min_value), Num(max_value)) => {
        if min_value > max_value {
          semantic_error(errors, line, column, "clamp() requires min <= max")
          return None
        }
        if value < min_value {
          Some(Num(min_value))
        } else if value > max_value {
          Some(Num(max_value))
        } else {
          Some(Num(value))
        }
      }
      _ => {
        semantic_error(errors, line, column, "clamp() expects int arguments")
        None
      }
    }
  } else if name == "startswith" {
    if args.length() != 2 {
      semantic_error(
        errors, line, column, "startswith() expects exactly 2 arguments",
      )
      return None
    }
    match (args[0], args[1]) {
      (Str(text), Str(prefix)) => Some(Bool(text.has_prefix(prefix)))
      _ => {
        semantic_error(
          errors, line, column, "startswith() expects string arguments",
        )
        None
      }
    }
  } else if name == "endswith" {
    if args.length() != 2 {
      semantic_error(
        errors, line, column, "endswith() expects exactly 2 arguments",
      )
      return None
    }
    match (args[0], args[1]) {
      (Str(text), Str(suffix)) => Some(Bool(text.has_suffix(suffix)))
      _ => {
        semantic_error(
          errors, line, column, "endswith() expects string arguments",
        )
        None
      }
    }
  } else if name == "get" {
    if args.length() < 2 || args.length() > 3 {
      semantic_error(errors, line, column, "get() expects 2 or 3 arguments")
      return None
    }
    let dict_arg = args[0]
    let key_arg = args[1]
    let default_arg = if args.length() == 3 { Some(args[2]) } else { None }
    match dict_arg {
      Dict(entries) =>
        match key_arg {
          Str(key) =>
            match entries.get(key) {
              Some(value) => Some(value)
              None =>
                match default_arg {
                  Some(value) => Some(value)
                  None => Some(NoneValue)
                }
            }
          _ => {
            semantic_error(errors, line, column, "get() key must be string")
            None
          }
        }
      _ => {
        semantic_error(
          errors, line, column, "get() first argument must be dict",
        )
        None
      }
    }
  } else {
    semantic_error(errors, line, column, "unknown expression function: \{name}")
    None
  }
}

///|
fn resolve_order_compare(
  op : String,
  left : StarlarkValue,
  right : StarlarkValue,
  line : Int,
  column : Int,
  errors : Array[String],
) -> StarlarkValue? {
  match (left, right) {
    (Num(lhs), Num(rhs)) => {
      let result = if op == "<" {
        lhs < rhs
      } else if op == "<=" {
        lhs <= rhs
      } else if op == ">" {
        lhs > rhs
      } else {
        lhs >= rhs
      }
      Some(Bool(result))
    }
    _ => {
      semantic_error(
        errors,
        line,
        column,
        "comparison '\{op}' requires int operands",
      )
      None
    }
  }
}

///|
fn resolve_in_membership(
  left : StarlarkValue,
  right : StarlarkValue,
  line : Int,
  column : Int,
  errors : Array[String],
) -> StarlarkValue? {
  match right {
    List(items) => {
      for item in items {
        if value_equals(left, item) {
          return Some(Bool(true))
        }
      }
      Some(Bool(false))
    }
    Dict(entries) =>
      match left {
        Str(key) => Some(Bool(entries.get(key) is Some(_)))
        _ => {
          semantic_error(
            errors, line, column, "left operand of 'in' must be string when right operand is dict",
          )
          None
        }
      }
    Str(text) =>
      match left {
        Str(sub) => Some(Bool(text.contains(sub)))
        _ => {
          semantic_error(
            errors, line, column, "left operand of 'in' must be string when right operand is string",
          )
          None
        }
      }
    _ => {
      semantic_error(
        errors, line, column, "right operand of 'in' must be string, list, or dict",
      )
      None
    }
  }
}

///|
fn value_equals(left : StarlarkValue, right : StarlarkValue) -> Bool {
  match (left, right) {
    (Str(lhs), Str(rhs)) => lhs == rhs
    (Num(lhs), Num(rhs)) => lhs == rhs
    (Bool(lhs), Bool(rhs)) => lhs == rhs
    (NoneValue, NoneValue) => true
    (List(lhs), List(rhs)) => {
      if lhs.length() != rhs.length() {
        return false
      }
      for i in 0..<lhs.length() {
        if not(value_equals(lhs[i], rhs[i])) {
          return false
        }
      }
      true
    }
    (Dict(lhs), Dict(rhs)) => {
      if lhs.length() != rhs.length() {
        return false
      }
      for key, value in lhs {
        match rhs.get(key) {
          Some(rhs_value) =>
            if not(value_equals(value, rhs_value)) {
              return false
            }
          None => return false
        }
      }
      true
    }
    _ => false
  }
}

///|
fn value_truthy(value : StarlarkValue) -> Bool {
  match value {
    Str(text) => text.length() > 0
    Num(num) => num != 0
    Bool(flag) => flag
    NoneValue => false
    List(items) => items.length() > 0
    Dict(entries) => entries.length() > 0
    _ => false
  }
}

///|
fn copy_expr_bindings(
  source : Map[String, StarlarkValue],
) -> Map[String, StarlarkValue] {
  let copied : Map[String, StarlarkValue] = {}
  for key, value in source {
    copied[key] = value
  }
  copied
}

///|
fn iterable_items_for_comprehension(
  value : StarlarkValue,
  line : Int,
  column : Int,
  errors : Array[String],
  owner : String,
) -> Array[StarlarkValue]? {
  match value {
    List(items) => Some(items)
    Dict(entries) => {
      let keys : Array[StarlarkValue] = []
      for key, _ in entries {
        keys.push(Str(key))
      }
      Some(keys)
    }
    Str(text) => {
      let chars : Array[StarlarkValue] = []
      for i in 0..<text.length() {
        chars.push(Str(String::unsafe_substring(text, start=i, end=i + 1)))
      }
      Some(chars)
    }
    _ => {
      semantic_error(
        errors,
        line,
        column,
        "\{owner} must be iterable (list, dict, or string)",
      )
      None
    }
  }
}

///|
fn resolve_value(
  value : StarlarkValue,
  bindings : Map[String, StarlarkValue],
  line : Int,
  column : Int,
  errors : Array[String],
) -> StarlarkValue? {
  match value {
    MethodCall(receiver, name, args) => {
      let resolved_receiver = match
        resolve_value(receiver, bindings, line, column, errors) {
        Some(value) => value
        None => return None
      }
      let resolved_args : Array[StarlarkValue] = []
      for arg in args {
        match resolve_value(arg, bindings, line, column, errors) {
          Some(v) => resolved_args.push(v)
          None => return None
        }
      }
      resolve_method_call(
        resolved_receiver, name, resolved_args, line, column, errors,
      )
    }
    Call(name, args) => {
      let resolved_args : Array[StarlarkValue] = []
      for arg in args {
        match resolve_value(arg, bindings, line, column, errors) {
          Some(v) => resolved_args.push(v)
          None => return None
        }
      }
      resolve_expr_call(name, resolved_args, line, column, errors)
    }
    ListComp(item_expr, loop_name, iter_expr, cond_expr) => {
      let resolved_iter = match
        resolve_value(iter_expr, bindings, line, column, errors) {
        Some(value) => value
        None => return None
      }
      let iter_items = match
        iterable_items_for_comprehension(
          resolved_iter, line, column, errors, "list comprehension iterable",
        ) {
        Some(items) => items
        None => return None
      }
      let resolved_items : Array[StarlarkValue] = []
      for iter_item in iter_items {
        let local_bindings = copy_expr_bindings(bindings)
        local_bindings[loop_name] = iter_item
        let should_include = match cond_expr {
          Some(cond_value) =>
            match
              resolve_value(cond_value, local_bindings, line, column, errors) {
              Some(cond_result) => value_truthy(cond_result)
              None => return None
            }
          None => true
        }
        if not(should_include) {
          continue
        }
        match resolve_value(item_expr, local_bindings, line, column, errors) {
          Some(resolved_item) => resolved_items.push(resolved_item)
          None => return None
        }
      }
      Some(List(resolved_items))
    }
    DictComp(key_expr, value_expr, loop_name, iter_expr, cond_expr) => {
      let resolved_iter = match
        resolve_value(iter_expr, bindings, line, column, errors) {
        Some(value) => value
        None => return None
      }
      let iter_items = match
        iterable_items_for_comprehension(
          resolved_iter, line, column, errors, "dict comprehension iterable",
        ) {
        Some(items) => items
        None => return None
      }
      let resolved_items : Map[String, StarlarkValue] = {}
      for iter_item in iter_items {
        let local_bindings = copy_expr_bindings(bindings)
        local_bindings[loop_name] = iter_item
        let should_include = match cond_expr {
          Some(cond_value) =>
            match
              resolve_value(cond_value, local_bindings, line, column, errors) {
              Some(cond_result) => value_truthy(cond_result)
              None => return None
            }
          None => true
        }
        if not(should_include) {
          continue
        }
        let resolved_key = match
          resolve_value(key_expr, local_bindings, line, column, errors) {
          Some(value) => value
          None => return None
        }
        let key = match resolved_key {
          Str(text) => text
          _ => {
            semantic_error(
              errors, line, column, "dict comprehension key must evaluate to string",
            )
            return None
          }
        }
        match resolve_value(value_expr, local_bindings, line, column, errors) {
          Some(resolved_value) => resolved_items[key] = resolved_value
          None => return None
        }
      }
      Some(Dict(resolved_items))
    }
    Slice(target, start, end, step) =>
      match resolve_value(target, bindings, line, column, errors) {
        Some(resolved_target) => {
          let resolved_start = match start {
            Some(expr) =>
              match resolve_value(expr, bindings, line, column, errors) {
                Some(v) => Some(v)
                None => return None
              }
            None => None
          }
          let resolved_end = match end {
            Some(expr) =>
              match resolve_value(expr, bindings, line, column, errors) {
                Some(v) => Some(v)
                None => return None
              }
            None => None
          }
          let resolved_step = match step {
            Some(expr) =>
              match resolve_value(expr, bindings, line, column, errors) {
                Some(v) => Some(v)
                None => return None
              }
            None => None
          }
          resolve_slice(
            resolved_target, resolved_start, resolved_end, resolved_step, line, column,
            errors,
          )
        }
        None => None
      }
    Index(target, index) =>
      match resolve_value(target, bindings, line, column, errors) {
        Some(resolved_target) =>
          match resolve_value(index, bindings, line, column, errors) {
            Some(resolved_index) =>
              resolve_index(
                resolved_target, resolved_index, line, column, errors,
              )
            None => None
          }
        None => None
      }
    Neg(expr) =>
      match resolve_value(expr, bindings, line, column, errors) {
        Some(resolved) => resolve_neg(resolved, line, column, errors)
        None => None
      }
    IfExpr(cond, then_value, else_value) =>
      match resolve_value(cond, bindings, line, column, errors) {
        Some(cond_value) =>
          if value_truthy(cond_value) {
            resolve_value(then_value, bindings, line, column, errors)
          } else {
            resolve_value(else_value, bindings, line, column, errors)
          }
        None => None
      }
    Lt(left, right) =>
      match resolve_value(left, bindings, line, column, errors) {
        Some(resolved_left) =>
          match resolve_value(right, bindings, line, column, errors) {
            Some(resolved_right) =>
              resolve_order_compare(
                "<", resolved_left, resolved_right, line, column, errors,
              )
            None => None
          }
        None => None
      }
    Lte(left, right) =>
      match resolve_value(left, bindings, line, column, errors) {
        Some(resolved_left) =>
          match resolve_value(right, bindings, line, column, errors) {
            Some(resolved_right) =>
              resolve_order_compare(
                "<=", resolved_left, resolved_right, line, column, errors,
              )
            None => None
          }
        None => None
      }
    Gt(left, right) =>
      match resolve_value(left, bindings, line, column, errors) {
        Some(resolved_left) =>
          match resolve_value(right, bindings, line, column, errors) {
            Some(resolved_right) =>
              resolve_order_compare(
                ">", resolved_left, resolved_right, line, column, errors,
              )
            None => None
          }
        None => None
      }
    Gte(left, right) =>
      match resolve_value(left, bindings, line, column, errors) {
        Some(resolved_left) =>
          match resolve_value(right, bindings, line, column, errors) {
            Some(resolved_right) =>
              resolve_order_compare(
                ">=", resolved_left, resolved_right, line, column, errors,
              )
            None => None
          }
        None => None
      }
    In(left, right) =>
      match resolve_value(left, bindings, line, column, errors) {
        Some(resolved_left) =>
          match resolve_value(right, bindings, line, column, errors) {
            Some(resolved_right) =>
              resolve_in_membership(
                resolved_left, resolved_right, line, column, errors,
              )
            None => None
          }
        None => None
      }
    NotIn(left, right) =>
      match resolve_value(left, bindings, line, column, errors) {
        Some(resolved_left) =>
          match resolve_value(right, bindings, line, column, errors) {
            Some(resolved_right) =>
              match
                resolve_in_membership(
                  resolved_left, resolved_right, line, column, errors,
                ) {
                Some(Bool(found)) => Some(Bool(not(found)))
                Some(_) => None
                None => None
              }
            None => None
          }
        None => None
      }
    Not(expr) =>
      match resolve_value(expr, bindings, line, column, errors) {
        Some(resolved) => Some(Bool(not(value_truthy(resolved))))
        None => None
      }
    And(left, right) =>
      match resolve_value(left, bindings, line, column, errors) {
        Some(resolved_left) =>
          if value_truthy(resolved_left) {
            resolve_value(right, bindings, line, column, errors)
          } else {
            Some(resolved_left)
          }
        None => None
      }
    Or(left, right) =>
      match resolve_value(left, bindings, line, column, errors) {
        Some(resolved_left) =>
          if value_truthy(resolved_left) {
            Some(resolved_left)
          } else {
            resolve_value(right, bindings, line, column, errors)
          }
        None => None
      }
    Eq(left, right) =>
      match resolve_value(left, bindings, line, column, errors) {
        Some(resolved_left) =>
          match resolve_value(right, bindings, line, column, errors) {
            Some(resolved_right) =>
              Some(Bool(value_equals(resolved_left, resolved_right)))
            None => None
          }
        None => None
      }
    NotEq(left, right) =>
      match resolve_value(left, bindings, line, column, errors) {
        Some(resolved_left) =>
          match resolve_value(right, bindings, line, column, errors) {
            Some(resolved_right) =>
              Some(Bool(not(value_equals(resolved_left, resolved_right))))
            None => None
          }
        None => None
      }
    Add(left, right) =>
      match resolve_value(left, bindings, line, column, errors) {
        Some(resolved_left) =>
          match resolve_value(right, bindings, line, column, errors) {
            Some(resolved_right) =>
              resolve_add(resolved_left, resolved_right, line, column, errors)
            None => None
          }
        None => None
      }
    Sub(left, right) =>
      match resolve_value(left, bindings, line, column, errors) {
        Some(resolved_left) =>
          match resolve_value(right, bindings, line, column, errors) {
            Some(resolved_right) =>
              resolve_sub(resolved_left, resolved_right, line, column, errors)
            None => None
          }
        None => None
      }
    Mul(left, right) =>
      match resolve_value(left, bindings, line, column, errors) {
        Some(resolved_left) =>
          match resolve_value(right, bindings, line, column, errors) {
            Some(resolved_right) =>
              resolve_mul(resolved_left, resolved_right, line, column, errors)
            None => None
          }
        None => None
      }
    FloorDiv(left, right) =>
      match resolve_value(left, bindings, line, column, errors) {
        Some(resolved_left) =>
          match resolve_value(right, bindings, line, column, errors) {
            Some(resolved_right) =>
              resolve_floor_div(
                resolved_left, resolved_right, line, column, errors,
              )
            None => None
          }
        None => None
      }
    Mod(left, right) =>
      match resolve_value(left, bindings, line, column, errors) {
        Some(resolved_left) =>
          match resolve_value(right, bindings, line, column, errors) {
            Some(resolved_right) =>
              resolve_mod(resolved_left, resolved_right, line, column, errors)
            None => None
          }
        None => None
      }
    Ref(name) =>
      match bindings.get(name) {
        Some(bound) => resolve_value(bound, bindings, line, column, errors)
        None => {
          semantic_error(errors, line, column, "unknown variable '\{name}'")
          None
        }
      }
    List(values) => {
      let resolved : Array[StarlarkValue] = []
      for item in values {
        match resolve_value(item, bindings, line, column, errors) {
          Some(value) => resolved.push(value)
          None => return None
        }
      }
      Some(List(resolved))
    }
    Dict(values) => {
      let resolved : Map[String, StarlarkValue] = {}
      for key, item in values {
        match resolve_value(item, bindings, line, column, errors) {
          Some(value) => resolved[key] = value
          None => return None
        }
      }
      Some(Dict(resolved))
    }
    _ => Some(value)
  }
}
