///|
// Host-level workflow semantics and IR lowering.
// Language-core expression evaluation is in lang_core.mbt.

///|
pub struct StarlarkNodeDecl {
  id : String
  depends_on : Array[String]
  required : Bool
}

///|
pub struct StarlarkTaskDecl {
  id : String
  node : String
  cmd : String
  needs : Array[String]
  required : Bool
  srcs : Array[String]
  outs : Array[String]
  env : Map[String, String]
  cwd : String
  trigger_mode : String
}

///|
pub struct StarlarkWorkflowDecl {
  name : String
  max_parallel : Int
  nodes : Array[StarlarkNodeDecl]
  tasks : Array[StarlarkTaskDecl]
  entry_targets : Array[String]
}

///|
pub struct StarlarkParseResult {
  workflow : StarlarkWorkflowDecl
  errors : Array[String]
}

///|
priv enum StarlarkControlSignal {
  Next
  BreakLoop
  ContinueLoop
  ReturnFromBlock(StarlarkValue)
}

///|
priv struct StarlarkFunctionDecl {
  params : Array[String]
  defaults : Map[String, StarlarkValue]
  body : String
}

///|
const FUNCTION_CALL_MAX_DEPTH : Int = 64

///|
fn copy_bindings(
  source : Map[String, StarlarkValue],
) -> Map[String, StarlarkValue] {
  let copied : Map[String, StarlarkValue] = {}
  for key, value in source {
    copied[key] = value
  }
  copied
}

///|
fn copy_functions(
  source : Map[String, StarlarkFunctionDecl],
) -> Map[String, StarlarkFunctionDecl] {
  let copied : Map[String, StarlarkFunctionDecl] = {}
  for key, value in source {
    copied[key] = value
  }
  copied
}

///|
fn is_positional_arg_name(name : String) -> Bool {
  name.has_prefix("$pos")
}

///|
fn iterable_values_for_context(
  value : StarlarkValue,
  line : Int,
  column : Int,
  errors : Array[String],
  owner : String,
  call_stack? : Array[String] = [],
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
      semantic_error_with_stack(
        errors,
        line,
        column,
        "\{owner} must be iterable (list, dict, or string)",
        call_stack,
      )
      None
    }
  }
}

///|
fn bind_function_args(
  fn_name : String,
  fn_decl : StarlarkFunctionDecl,
  positional_values : Array[StarlarkValue],
  keyword_values : Map[String, StarlarkValue],
  line : Int,
  column : Int,
  errors : Array[String],
  call_stack : Array[String],
) -> Map[String, StarlarkValue]? {
  let bound : Map[String, StarlarkValue] = {}
  let mut invalid = false
  if positional_values.length() > fn_decl.params.length() {
    semantic_error_with_stack(
      errors,
      line,
      column,
      "too many positional arguments for function \{fn_name}",
      call_stack,
    )
    invalid = true
  }
  let mut idx = 0
  for value in positional_values {
    if idx < fn_decl.params.length() {
      let param = fn_decl.params[idx]
      bound[param] = value
    }
    idx += 1
  }
  for key, value in keyword_values {
    if not(fn_decl.params.contains(key)) {
      semantic_error_with_stack(
        errors,
        line,
        column,
        "unknown argument '\{key}' for function \{fn_name}",
        call_stack,
      )
      invalid = true
      continue
    }
    if bound.get(key) is Some(_) {
      semantic_error_with_stack(
        errors,
        line,
        column,
        "multiple values for argument '\{key}' in function \{fn_name}",
        call_stack,
      )
      invalid = true
      continue
    }
    bound[key] = value
  }
  for param in fn_decl.params {
    if bound.get(param) is Some(_) {
      continue
    }
    match fn_decl.defaults.get(param) {
      Some(default_value) => bound[param] = default_value
      None => {
        semantic_error_with_stack(
          errors,
          line,
          column,
          "missing argument '\{param}' for function \{fn_name}",
          call_stack,
        )
        invalid = true
      }
    }
  }
  if invalid {
    None
  } else {
    Some(bound)
  }
}

///|
fn call_function_with_resolved_args(
  fn_name : String,
  fn_decl : StarlarkFunctionDecl,
  positional_values : Array[StarlarkValue],
  keyword_values : Map[String, StarlarkValue],
  bindings : Map[String, StarlarkValue],
  functions : Map[String, StarlarkFunctionDecl],
  line : Int,
  column : Int,
  errors : Array[String],
  call_stack : Array[String],
) -> StarlarkValue? {
  if call_stack.length() > FUNCTION_CALL_MAX_DEPTH {
    semantic_error_with_stack(
      errors,
      line,
      column,
      "function call depth exceeded \{FUNCTION_CALL_MAX_DEPTH}",
      call_stack,
    )
    return None
  }
  let bound_args = match
    bind_function_args(
      fn_name, fn_decl, positional_values, keyword_values, line, column, errors,
      call_stack,
    ) {
    Some(bound) => bound
    None => return None
  }
  let local_bindings = copy_bindings(bindings)
  for key, value in bound_args {
    local_bindings[key] = value
  }
  let nested = parse_syntax(fn_decl.body)
  for err in nested.errors {
    errors.push(err)
  }
  let nodes : Array[StarlarkNodeDecl] = []
  let tasks : Array[StarlarkTaskDecl] = []
  let entry_targets : Array[String] = []
  let var_types : Map[String, String] = {}
  let required_pending : Map[String, Bool] = {}
  let required_locations : Map[String, (Int, Int)] = {}
  let external_inputs : Map[String, String] = {}
  let local_functions = copy_functions(functions)
  let (_, _, _, signal) = apply_calls(
    nested.calls,
    nodes,
    tasks,
    entry_targets,
    local_bindings,
    var_types,
    required_pending,
    required_locations,
    external_inputs,
    errors,
    "default",
    1,
    false,
    local_functions,
    0,
    call_stack,
  )
  match signal {
    ReturnFromBlock(value) => Some(value)
    _ => Some(NoneValue)
  }
}

///|
fn resolve_value_with_functions(
  value : StarlarkValue,
  bindings : Map[String, StarlarkValue],
  functions : Map[String, StarlarkFunctionDecl],
  line : Int,
  column : Int,
  errors : Array[String],
  call_stack? : Array[String] = [],
) -> StarlarkValue? {
  match value {
    MethodCall(receiver, name, args) => {
      let resolved_receiver = match
        resolve_value_with_functions(
          receiver,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(value) => value
        None => return None
      }
      let resolved_args : Array[StarlarkValue] = []
      for arg in args {
        match
          resolve_value_with_functions(
            arg,
            bindings,
            functions,
            line,
            column,
            errors,
            call_stack~,
          ) {
          Some(v) => resolved_args.push(v)
          None => return None
        }
      }
      resolve_method_call(
        resolved_receiver, name, resolved_args, line, column, errors,
      )
    }
    Call(name, args) => {
      let positional_args : Array[StarlarkValue] = []
      let keyword_args : Map[String, StarlarkValue] = {}
      for arg in args {
        match arg {
          CallKwArg(key, value_expr) =>
            match
              resolve_value_with_functions(
                value_expr,
                bindings,
                functions,
                line,
                column,
                errors,
                call_stack~,
              ) {
              Some(v) =>
                if keyword_args.get(key) is Some(_) {
                  semantic_error_with_stack(
                    errors,
                    line,
                    column,
                    "duplicate keyword argument '\{key}' in expression call",
                    call_stack,
                  )
                  return None
                } else {
                  keyword_args[key] = v
                }
              None => return None
            }
          _ =>
            match
              resolve_value_with_functions(
                arg,
                bindings,
                functions,
                line,
                column,
                errors,
                call_stack~,
              ) {
              Some(v) => positional_args.push(v)
              None => return None
            }
        }
      }
      match functions.get(name) {
        Some(fn_decl) => {
          let nested_stack : Array[String] = []
          for item in call_stack {
            nested_stack.push(item)
          }
          nested_stack.push(name)
          call_function_with_resolved_args(
            name, fn_decl, positional_args, keyword_args, bindings, functions, line,
            column, errors, nested_stack,
          )
        }
        None =>
          if keyword_args.length() > 0 {
            semantic_error_with_stack(
              errors,
              line,
              column,
              "keyword arguments are not supported for expression function \{name}",
              call_stack,
            )
            None
          } else {
            resolve_expr_call(name, positional_args, line, column, errors)
          }
      }
    }
    ListComp(item_expr, loop_name, iter_expr, cond_expr) => {
      let resolved_iter = match
        resolve_value_with_functions(
          iter_expr,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(value) => value
        None => return None
      }
      let iter_items = match
        iterable_values_for_context(
          resolved_iter,
          line,
          column,
          errors,
          "list comprehension iterable",
          call_stack~,
        ) {
        Some(items) => items
        None => return None
      }
      let resolved_items : Array[StarlarkValue] = []
      for iter_item in iter_items {
        let local_bindings = copy_bindings(bindings)
        local_bindings[loop_name] = iter_item
        let should_include = match cond_expr {
          Some(cond_value) =>
            match
              resolve_value_with_functions(
                cond_value,
                local_bindings,
                functions,
                line,
                column,
                errors,
                call_stack~,
              ) {
              Some(cond_result) => value_truthy(cond_result)
              None => return None
            }
          None => true
        }
        if not(should_include) {
          continue
        }
        match
          resolve_value_with_functions(
            item_expr,
            local_bindings,
            functions,
            line,
            column,
            errors,
            call_stack~,
          ) {
          Some(resolved_item) => resolved_items.push(resolved_item)
          None => return None
        }
      }
      Some(List(resolved_items))
    }
    DictComp(key_expr, value_expr, loop_name, iter_expr, cond_expr) => {
      let resolved_iter = match
        resolve_value_with_functions(
          iter_expr,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(value) => value
        None => return None
      }
      let iter_items = match
        iterable_values_for_context(
          resolved_iter,
          line,
          column,
          errors,
          "dict comprehension iterable",
          call_stack~,
        ) {
        Some(items) => items
        None => return None
      }
      let resolved_items : Map[String, StarlarkValue] = {}
      for iter_item in iter_items {
        let local_bindings = copy_bindings(bindings)
        local_bindings[loop_name] = iter_item
        let should_include = match cond_expr {
          Some(cond_value) =>
            match
              resolve_value_with_functions(
                cond_value,
                local_bindings,
                functions,
                line,
                column,
                errors,
                call_stack~,
              ) {
              Some(cond_result) => value_truthy(cond_result)
              None => return None
            }
          None => true
        }
        if not(should_include) {
          continue
        }
        let resolved_key = match
          resolve_value_with_functions(
            key_expr,
            local_bindings,
            functions,
            line,
            column,
            errors,
            call_stack~,
          ) {
          Some(value) => value
          None => return None
        }
        let key = match resolved_key {
          Str(text) => text
          _ => {
            semantic_error_with_stack(
              errors, line, column, "dict comprehension key must evaluate to string",
              call_stack,
            )
            return None
          }
        }
        match
          resolve_value_with_functions(
            value_expr,
            local_bindings,
            functions,
            line,
            column,
            errors,
            call_stack~,
          ) {
          Some(resolved_value) => resolved_items[key] = resolved_value
          None => return None
        }
      }
      Some(Dict(resolved_items))
    }
    CallKwArg(_, _) => {
      semantic_error_with_stack(
        errors, line, column, "keyword argument is only allowed inside function calls",
        call_stack,
      )
      None
    }
    Slice(target, start, end, step) =>
      match
        resolve_value_with_functions(
          target,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(resolved_target) => {
          let resolved_start = match start {
            Some(expr) =>
              match
                resolve_value_with_functions(
                  expr,
                  bindings,
                  functions,
                  line,
                  column,
                  errors,
                  call_stack~,
                ) {
                Some(v) => Some(v)
                None => return None
              }
            None => None
          }
          let resolved_end = match end {
            Some(expr) =>
              match
                resolve_value_with_functions(
                  expr,
                  bindings,
                  functions,
                  line,
                  column,
                  errors,
                  call_stack~,
                ) {
                Some(v) => Some(v)
                None => return None
              }
            None => None
          }
          let resolved_step = match step {
            Some(expr) =>
              match
                resolve_value_with_functions(
                  expr,
                  bindings,
                  functions,
                  line,
                  column,
                  errors,
                  call_stack~,
                ) {
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
      match
        resolve_value_with_functions(
          target,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(resolved_target) =>
          match
            resolve_value_with_functions(
              index,
              bindings,
              functions,
              line,
              column,
              errors,
              call_stack~,
            ) {
            Some(resolved_index) =>
              resolve_index(
                resolved_target, resolved_index, line, column, errors,
              )
            None => None
          }
        None => None
      }
    Neg(expr) =>
      match
        resolve_value_with_functions(
          expr,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(resolved) => resolve_neg(resolved, line, column, errors)
        None => None
      }
    IfExpr(cond, then_value, else_value) =>
      match
        resolve_value_with_functions(
          cond,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(cond_value) =>
          if value_truthy(cond_value) {
            resolve_value_with_functions(
              then_value,
              bindings,
              functions,
              line,
              column,
              errors,
              call_stack~,
            )
          } else {
            resolve_value_with_functions(
              else_value,
              bindings,
              functions,
              line,
              column,
              errors,
              call_stack~,
            )
          }
        None => None
      }
    Lt(left, right) =>
      match
        resolve_value_with_functions(
          left,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(resolved_left) =>
          match
            resolve_value_with_functions(
              right,
              bindings,
              functions,
              line,
              column,
              errors,
              call_stack~,
            ) {
            Some(resolved_right) =>
              resolve_order_compare(
                "<", resolved_left, resolved_right, line, column, errors,
              )
            None => None
          }
        None => None
      }
    Lte(left, right) =>
      match
        resolve_value_with_functions(
          left,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(resolved_left) =>
          match
            resolve_value_with_functions(
              right,
              bindings,
              functions,
              line,
              column,
              errors,
              call_stack~,
            ) {
            Some(resolved_right) =>
              resolve_order_compare(
                "<=", resolved_left, resolved_right, line, column, errors,
              )
            None => None
          }
        None => None
      }
    Gt(left, right) =>
      match
        resolve_value_with_functions(
          left,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(resolved_left) =>
          match
            resolve_value_with_functions(
              right,
              bindings,
              functions,
              line,
              column,
              errors,
              call_stack~,
            ) {
            Some(resolved_right) =>
              resolve_order_compare(
                ">", resolved_left, resolved_right, line, column, errors,
              )
            None => None
          }
        None => None
      }
    Gte(left, right) =>
      match
        resolve_value_with_functions(
          left,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(resolved_left) =>
          match
            resolve_value_with_functions(
              right,
              bindings,
              functions,
              line,
              column,
              errors,
              call_stack~,
            ) {
            Some(resolved_right) =>
              resolve_order_compare(
                ">=", resolved_left, resolved_right, line, column, errors,
              )
            None => None
          }
        None => None
      }
    In(left, right) =>
      match
        resolve_value_with_functions(
          left,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(resolved_left) =>
          match
            resolve_value_with_functions(
              right,
              bindings,
              functions,
              line,
              column,
              errors,
              call_stack~,
            ) {
            Some(resolved_right) =>
              resolve_in_membership(
                resolved_left, resolved_right, line, column, errors,
              )
            None => None
          }
        None => None
      }
    NotIn(left, right) =>
      match
        resolve_value_with_functions(
          left,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(resolved_left) =>
          match
            resolve_value_with_functions(
              right,
              bindings,
              functions,
              line,
              column,
              errors,
              call_stack~,
            ) {
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
      match
        resolve_value_with_functions(
          expr,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(resolved) => Some(Bool(not(value_truthy(resolved))))
        None => None
      }
    And(left, right) =>
      match
        resolve_value_with_functions(
          left,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(resolved_left) =>
          if value_truthy(resolved_left) {
            resolve_value_with_functions(
              right,
              bindings,
              functions,
              line,
              column,
              errors,
              call_stack~,
            )
          } else {
            Some(resolved_left)
          }
        None => None
      }
    Or(left, right) =>
      match
        resolve_value_with_functions(
          left,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(resolved_left) =>
          if value_truthy(resolved_left) {
            Some(resolved_left)
          } else {
            resolve_value_with_functions(
              right,
              bindings,
              functions,
              line,
              column,
              errors,
              call_stack~,
            )
          }
        None => None
      }
    Eq(left, right) =>
      match
        resolve_value_with_functions(
          left,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(resolved_left) =>
          match
            resolve_value_with_functions(
              right,
              bindings,
              functions,
              line,
              column,
              errors,
              call_stack~,
            ) {
            Some(resolved_right) =>
              Some(Bool(value_equals(resolved_left, resolved_right)))
            None => None
          }
        None => None
      }
    NotEq(left, right) =>
      match
        resolve_value_with_functions(
          left,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(resolved_left) =>
          match
            resolve_value_with_functions(
              right,
              bindings,
              functions,
              line,
              column,
              errors,
              call_stack~,
            ) {
            Some(resolved_right) =>
              Some(Bool(not(value_equals(resolved_left, resolved_right))))
            None => None
          }
        None => None
      }
    Add(left, right) =>
      match
        resolve_value_with_functions(
          left,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(resolved_left) =>
          match
            resolve_value_with_functions(
              right,
              bindings,
              functions,
              line,
              column,
              errors,
              call_stack~,
            ) {
            Some(resolved_right) =>
              resolve_add(resolved_left, resolved_right, line, column, errors)
            None => None
          }
        None => None
      }
    Sub(left, right) =>
      match
        resolve_value_with_functions(
          left,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(resolved_left) =>
          match
            resolve_value_with_functions(
              right,
              bindings,
              functions,
              line,
              column,
              errors,
              call_stack~,
            ) {
            Some(resolved_right) =>
              resolve_sub(resolved_left, resolved_right, line, column, errors)
            None => None
          }
        None => None
      }
    Mul(left, right) =>
      match
        resolve_value_with_functions(
          left,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(resolved_left) =>
          match
            resolve_value_with_functions(
              right,
              bindings,
              functions,
              line,
              column,
              errors,
              call_stack~,
            ) {
            Some(resolved_right) =>
              resolve_mul(resolved_left, resolved_right, line, column, errors)
            None => None
          }
        None => None
      }
    FloorDiv(left, right) =>
      match
        resolve_value_with_functions(
          left,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(resolved_left) =>
          match
            resolve_value_with_functions(
              right,
              bindings,
              functions,
              line,
              column,
              errors,
              call_stack~,
            ) {
            Some(resolved_right) =>
              resolve_floor_div(
                resolved_left, resolved_right, line, column, errors,
              )
            None => None
          }
        None => None
      }
    Mod(left, right) =>
      match
        resolve_value_with_functions(
          left,
          bindings,
          functions,
          line,
          column,
          errors,
          call_stack~,
        ) {
        Some(resolved_left) =>
          match
            resolve_value_with_functions(
              right,
              bindings,
              functions,
              line,
              column,
              errors,
              call_stack~,
            ) {
            Some(resolved_right) =>
              resolve_mod(resolved_left, resolved_right, line, column, errors)
            None => None
          }
        None => None
      }
    Ref(name) =>
      match bindings.get(name) {
        Some(bound) =>
          resolve_value_with_functions(
            bound,
            bindings,
            functions,
            line,
            column,
            errors,
            call_stack~,
          )
        None => {
          semantic_error_with_stack(
            errors,
            line,
            column,
            "unknown variable '\{name}'",
            call_stack,
          )
          None
        }
      }
    List(values) => {
      let resolved : Array[StarlarkValue] = []
      for item in values {
        match
          resolve_value_with_functions(
            item,
            bindings,
            functions,
            line,
            column,
            errors,
            call_stack~,
          ) {
          Some(value) => resolved.push(value)
          None => return None
        }
      }
      Some(List(resolved))
    }
    Dict(values) => {
      let resolved : Map[String, StarlarkValue] = {}
      for key, item in values {
        match
          resolve_value_with_functions(
            item,
            bindings,
            functions,
            line,
            column,
            errors,
            call_stack~,
          ) {
          Some(value) => resolved[key] = value
          None => return None
        }
      }
      Some(Dict(resolved))
    }
    _ => resolve_value(value, bindings, line, column, errors)
  }
}

///|
fn semantic_error(
  errors : Array[String],
  line : Int,
  column : Int,
  msg : String,
) -> Unit {
  errors.push("line \{line}, col \{column}: " + msg)
}

///|
fn semantic_error_with_stack(
  errors : Array[String],
  line : Int,
  column : Int,
  msg : String,
  call_stack : Array[String],
) -> Unit {
  if call_stack.length() == 0 {
    semantic_error(errors, line, column, msg)
  } else {
    semantic_error(
      errors,
      line,
      column,
      msg + " (call stack: " + call_stack.join(" -> ") + ")",
    )
  }
}

///|
fn arg_map(
  call : StarlarkCall,
  errors : Array[String],
) -> Map[String, StarlarkArg] {
  let mapped : Map[String, StarlarkArg] = {}
  for arg in call.args {
    if mapped.get(arg.name) is Some(_) {
      semantic_error(
        errors,
        arg.line,
        arg.column,
        "duplicate argument '\{arg.name}'",
      )
    } else {
      mapped[arg.name] = arg
    }
  }
  mapped
}

///|

///|
fn arg_map_resolved(
  call : StarlarkCall,
  bindings : Map[String, StarlarkValue],
  functions : Map[String, StarlarkFunctionDecl],
  errors : Array[String],
  call_stack? : Array[String] = [],
) -> Map[String, StarlarkArg] {
  let mapped : Map[String, StarlarkArg] = {}
  for arg in call.args {
    if mapped.get(arg.name) is Some(_) {
      semantic_error(
        errors,
        arg.line,
        arg.column,
        "duplicate argument '\{arg.name}'",
      )
      continue
    }
    match
      resolve_value_with_functions(
        arg.value,
        bindings,
        functions,
        arg.line,
        arg.column,
        errors,
        call_stack~,
      ) {
      Some(value) =>
        mapped[arg.name] = {
          name: arg.name,
          value,
          line: arg.line,
          column: arg.column,
        }
      None => ()
    }
  }
  mapped
}

///|
fn call_has_arg(call : StarlarkCall, key : String) -> Bool {
  for arg in call.args {
    if arg.name == key {
      return true
    }
  }
  false
}

///|
fn validate_unknown_args(
  call : StarlarkCall,
  allowed : Array[String],
  errors : Array[String],
) -> Unit {
  for arg in call.args {
    if not(allowed.contains(arg.name)) {
      semantic_error(
        errors,
        arg.line,
        arg.column,
        "unknown argument '\{arg.name}' for \{call.name}",
      )
    }
  }
}

///|
fn validate_call_shape(
  call : StarlarkCall,
  args : Map[String, StarlarkArg],
  errors : Array[String],
) -> Unit {
  let allowed = builtin_allowed_args(call.name)
  if allowed.length() > 0 {
    validate_unknown_args(call, allowed, errors)
  }
  for key in builtin_required_args(call.name) {
    if args.get(key) is None {
      if call_has_arg(call, key) {
        // The argument was provided syntactically but failed to resolve.
        // Keep the root resolution error and skip noisy "required" reports.
        continue
      }
      semantic_error(
        errors,
        call.line,
        call.column,
        "\{call.name}.\{key} is required",
      )
    }
  }
}

///|
fn required_arg(
  call : StarlarkCall,
  args : Map[String, StarlarkArg],
  key : String,
  errors : Array[String],
) -> StarlarkArg? {
  match args.get(key) {
    Some(arg) => Some(arg)
    None => {
      semantic_error(
        errors,
        call.line,
        call.column,
        "\{call.name}.\{key} is required",
      )
      None
    }
  }
}

///|
fn expect_string(
  owner : String,
  key : String,
  arg : StarlarkArg,
  errors : Array[String],
) -> String? {
  match arg.value {
    Str(value) => Some(value)
    _ => {
      semantic_error(
        errors,
        arg.line,
        arg.column,
        "\{owner}.\{key} must be string",
      )
      None
    }
  }
}

///|
fn expect_int(
  owner : String,
  key : String,
  arg : StarlarkArg,
  errors : Array[String],
) -> Int? {
  match arg.value {
    Num(value) => Some(value)
    _ => {
      semantic_error(
        errors,
        arg.line,
        arg.column,
        "\{owner}.\{key} must be int",
      )
      None
    }
  }
}

///|
fn expect_bool(
  owner : String,
  key : String,
  arg : StarlarkArg,
  errors : Array[String],
) -> Bool? {
  match arg.value {
    Bool(value) => Some(value)
    _ => {
      semantic_error(
        errors,
        arg.line,
        arg.column,
        "\{owner}.\{key} must be bool",
      )
      None
    }
  }
}

///|
fn expect_trigger_mode(arg : StarlarkArg, errors : Array[String]) -> String? {
  match expect_string("task", "trigger", arg, errors) {
    Some(mode) =>
      if mode == "auto" || mode == "manual" {
        Some(mode)
      } else {
        semantic_error(
          errors,
          arg.line,
          arg.column,
          "task.trigger must be 'auto' or 'manual'",
        )
        None
      }
    None => None
  }
}

///|
fn expect_string_list(
  owner : String,
  key : String,
  arg : StarlarkArg,
  errors : Array[String],
) -> Array[String]? {
  match arg.value {
    List(values) => {
      let result : Array[String] = []
      for value in values {
        match value {
          Str(text) => result.push(text)
          _ => {
            semantic_error(
              errors,
              arg.line,
              arg.column,
              "\{owner}.\{key} must be [string]",
            )
            return None
          }
        }
      }
      Some(result)
    }
    _ => {
      semantic_error(
        errors,
        arg.line,
        arg.column,
        "\{owner}.\{key} must be [string]",
      )
      None
    }
  }
}

///|
fn expect_string_dict(
  owner : String,
  key : String,
  arg : StarlarkArg,
  errors : Array[String],
) -> Map[String, String]? {
  match arg.value {
    Dict(values) => {
      let result : Map[String, String] = {}
      for dict_key, value in values {
        match value {
          Str(text) => result[dict_key] = text
          _ => {
            semantic_error(
              errors,
              arg.line,
              arg.column,
              "\{owner}.\{key} must be {string:string}",
            )
            return None
          }
        }
      }
      Some(result)
    }
    _ => {
      semantic_error(
        errors,
        arg.line,
        arg.column,
        "\{owner}.\{key} must be {string:string}",
      )
      None
    }
  }
}

///|
fn expect_task_cmd(arg : StarlarkArg, errors : Array[String]) -> String? {
  match arg.value {
    Str(cmd) => Some(cmd)
    List(values) => {
      let parts : Array[String] = []
      for value in values {
        match value {
          Str(text) => parts.push(text)
          _ => {
            semantic_error(
              errors,
              arg.line,
              arg.column,
              "task.cmd must be string or [string]",
            )
            return None
          }
        }
      }
      if parts.length() == 0 {
        semantic_error(
          errors,
          arg.line,
          arg.column,
          "task.cmd must be string or [string]",
        )
        None
      } else {
        Some(parts.join(" "))
      }
    }
    _ => {
      semantic_error(
        errors,
        arg.line,
        arg.column,
        "task.cmd must be string or [string]",
      )
      None
    }
  }
}

///|
fn apply_assignment(
  call : StarlarkCall,
  bindings : Map[String, StarlarkValue],
  functions : Map[String, StarlarkFunctionDecl],
  errors : Array[String],
  call_stack? : Array[String] = [],
) -> Unit {
  let args = arg_map(call, errors)
  let name_arg = match required_arg(call, args, "name", errors) {
    Some(arg) => arg
    None => return
  }
  let value_arg = match required_arg(call, args, "value", errors) {
    Some(arg) => arg
    None => return
  }
  let name = match expect_string("assign", "name", name_arg, errors) {
    Some(value) => value
    None => return
  }
  match
    resolve_value_with_functions(
      value_arg.value,
      bindings,
      functions,
      value_arg.line,
      value_arg.column,
      errors,
      call_stack~,
    ) {
    Some(value) => bindings[name] = value
    None => ()
  }
}

///|
fn var_allowed_types() -> Array[String] {
  ["any", "string", "int", "bool", "string_list", "string_dict"]
}

///|
fn value_matches_type(value : StarlarkValue, typ : String) -> Bool {
  if typ == "any" {
    return true
  }
  match value {
    Str(_) => typ == "string"
    Num(_) => typ == "int"
    Bool(_) => typ == "bool"
    NoneValue => false
    List(items) => {
      if typ != "string_list" {
        return false
      }
      for item in items {
        match item {
          Str(_) => ()
          _ => return false
        }
      }
      true
    }
    Dict(entries) => {
      if typ != "string_dict" {
        return false
      }
      for _, item in entries {
        match item {
          Str(_) => ()
          _ => return false
        }
      }
      true
    }
    ListComp(_, _, _, _) => false
    DictComp(_, _, _, _, _) => false
    Ref(_) => false
    MethodCall(_, _, _) => false
    CallKwArg(_, _) => false
    Call(_, _) => false
    Slice(_, _, _, _) => false
    Index(_, _) => false
    Neg(_) => false
    Add(_, _) => false
    Sub(_, _) => false
    Mul(_, _) => false
    FloorDiv(_, _) => false
    Mod(_, _) => false
    Eq(_, _) => false
    NotEq(_, _) => false
    Lt(_, _) => false
    Lte(_, _) => false
    Gt(_, _) => false
    Gte(_, _) => false
    In(_, _) => false
    NotIn(_, _) => false
    Not(_) => false
    And(_, _) => false
    Or(_, _) => false
    IfExpr(_, _, _) => false
  }
}

///|
fn infer_var_type(value : StarlarkValue) -> String {
  match value {
    Str(_) => "string"
    Num(_) => "int"
    Bool(_) => "bool"
    NoneValue => "any"
    List(items) => {
      for item in items {
        match item {
          Str(_) => ()
          _ => return "any"
        }
      }
      "string_list"
    }
    Dict(entries) => {
      for _, item in entries {
        match item {
          Str(_) => ()
          _ => return "any"
        }
      }
      "string_dict"
    }
    ListComp(_, _, _, _) => "any"
    DictComp(_, _, _, _, _) => "any"
    Ref(_) => "any"
    MethodCall(_, _, _) => "any"
    CallKwArg(_, _) => "any"
    Call(_, _) => "any"
    Slice(_, _, _, _) => "any"
    Index(_, _) => "any"
    Neg(_) => "any"
    Add(_, _) => "any"
    Sub(_, _) => "any"
    Mul(_, _) => "any"
    FloorDiv(_, _) => "any"
    Mod(_, _) => "any"
    Eq(_, _) => "any"
    NotEq(_, _) => "any"
    Lt(_, _) => "any"
    Lte(_, _) => "any"
    Gt(_, _) => "any"
    Gte(_, _) => "any"
    In(_, _) => "any"
    NotIn(_, _) => "any"
    Not(_) => "any"
    And(_, _) => "any"
    Or(_, _) => "any"
    IfExpr(_, _, _) => "any"
  }
}

///|
fn trim_ascii_space(text : String) -> String {
  let mut start = 0
  let mut end = text.length()
  while start < end {
    let ch = text.unsafe_get(start)
    if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
      start += 1
    } else {
      break
    }
  }
  while end > start {
    let ch = text.unsafe_get(end - 1)
    if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
      end -= 1
    } else {
      break
    }
  }
  if start == 0 && end == text.length() {
    text
  } else {
    String::unsafe_substring(text, start~, end~)
  }
}

///|
fn parse_external_int(raw : String) -> Int? {
  let text = trim_ascii_space(raw)
  if text.length() == 0 {
    return None
  }
  let mut idx = 0
  let mut negative = false
  let first = text.unsafe_get(0)
  if first == '-' {
    negative = true
    idx = 1
  } else if first == '+' {
    idx = 1
  }
  if idx >= text.length() {
    return None
  }
  let mut value = 0
  while idx < text.length() {
    let ch = text.unsafe_get(idx)
    if ch < '0' || ch > '9' {
      return None
    }
    value = value * 10 + (ch.to_int() - '0'.to_int())
    idx += 1
  }
  if negative {
    value = -value
  }
  Some(value)
}

///|
fn parse_external_string_list(raw : String) -> StarlarkValue {
  let text = trim_ascii_space(raw)
  if text.length() == 0 {
    return List([])
  }
  let items : Array[StarlarkValue] = []
  for view in text.split(",") {
    let item = trim_ascii_space(view.to_string())
    items.push(Str(item))
  }
  List(items)
}

///|
fn parse_external_string_dict(raw : String) -> Map[String, StarlarkValue]? {
  let text = trim_ascii_space(raw)
  if text.length() == 0 {
    return Some({})
  }
  let values : Map[String, StarlarkValue] = {}
  for part_view in text.split(",") {
    let part = trim_ascii_space(part_view.to_string())
    if part.length() == 0 {
      return None
    }
    guard part.find("=") is Some(eq_idx) else { return None }
    let key = trim_ascii_space(
      String::unsafe_substring(part, start=0, end=eq_idx),
    )
    let value = trim_ascii_space(
      String::unsafe_substring(part, start=eq_idx + 1, end=part.length()),
    )
    if key.length() == 0 {
      return None
    }
    values[key] = Str(value)
  }
  Some(values)
}

///|
fn parse_external_input_value(
  name : String,
  typ : String,
  raw : String,
  line : Int,
  column : Int,
  errors : Array[String],
) -> StarlarkValue? {
  if typ == "any" || typ == "string" {
    return Some(Str(raw))
  }
  if typ == "int" {
    match parse_external_int(raw) {
      Some(value) => return Some(Num(value))
      None => {
        semantic_error(
          errors,
          line,
          column,
          "external input for '\{name}' must be int",
        )
        return None
      }
    }
  }
  if typ == "bool" {
    let text = trim_ascii_space(raw)
    if text == "true" || text == "True" || text == "1" {
      return Some(Bool(true))
    }
    if text == "false" || text == "False" || text == "0" {
      return Some(Bool(false))
    }
    semantic_error(
      errors,
      line,
      column,
      "external input for '\{name}' must be bool",
    )
    return None
  }
  if typ == "string_list" {
    return Some(parse_external_string_list(raw))
  }
  if typ == "string_dict" {
    match parse_external_string_dict(raw) {
      Some(values) => return Some(Dict(values))
      None => {
        semantic_error(
          errors,
          line,
          column,
          "external input for '\{name}' must be key=value,key=value",
        )
        return None
      }
    }
  }
  semantic_error(errors, line, column, "unsupported var type '\{typ}'")
  None
}

///|
fn apply_var_call(
  call : StarlarkCall,
  args : Map[String, StarlarkArg],
  bindings : Map[String, StarlarkValue],
  var_types : Map[String, String],
  required_pending : Map[String, Bool],
  required_locations : Map[String, (Int, Int)],
  external_inputs : Map[String, String],
  errors : Array[String],
) -> Unit {
  for key in ["name", "type", "required", "default"] {
    if call_has_arg(call, key) && args.get(key) is None {
      return
    }
  }
  let name_arg = match args.get("name") {
    Some(arg) => arg
    None => return
  }
  let name = match expect_string("var", "name", name_arg, errors) {
    Some(value) => value
    None => return
  }
  let mut required = false
  match args.get("required") {
    Some(required_arg) =>
      match expect_bool("var", "required", required_arg, errors) {
        Some(value) => required = value
        None => return
      }
    None => ()
  }

  let default_arg = args.get("default")
  let default_value = match default_arg {
    Some(arg) => Some(arg.value)
    None => None
  }
  let mut typ = match default_value {
    Some(value) => infer_var_type(value)
    None => "string"
  }
  match args.get("type") {
    Some(type_arg) =>
      match expect_string("var", "type", type_arg, errors) {
        Some(type_name) => {
          if not(var_allowed_types().contains(type_name)) {
            semantic_error(
              errors,
              type_arg.line,
              type_arg.column,
              "var.type must be one of " + var_allowed_types().join(", "),
            )
            return
          }
          typ = type_name
        }
        None => return
      }
    None => ()
  }
  match default_arg {
    Some(arg) =>
      if not(value_matches_type(arg.value, typ)) {
        semantic_error(
          errors,
          arg.line,
          arg.column,
          "var.default must match type '\{typ}'",
        )
        return
      }
    None => ()
  }
  if default_arg is None && not(required) {
    semantic_error(
      errors,
      call.line,
      call.column,
      "var.default is required when var.required is false",
    )
    return
  }

  let mut resolved_by_external = false
  match external_inputs.get(name) {
    Some(raw_value) =>
      match
        parse_external_input_value(
          name,
          typ,
          raw_value,
          name_arg.line,
          name_arg.column,
          errors,
        ) {
        Some(parsed) => {
          bindings[name] = parsed
          resolved_by_external = true
        }
        None => return
      }
    None =>
      match default_value {
        Some(value) => bindings[name] = value
        None => ()
      }
  }

  var_types[name] = typ
  if required {
    required_locations[name] = (name_arg.line, name_arg.column)
    required_pending[name] = true
    if resolved_by_external {
      required_pending[name] = false
    }
  }
}

///|
fn apply_config_call(
  call : StarlarkCall,
  args : Map[String, StarlarkArg],
  bindings : Map[String, StarlarkValue],
  var_types : Map[String, String],
  required_pending : Map[String, Bool],
  errors : Array[String],
) -> Unit {
  let name_arg = match args.get("name") {
    Some(arg) => arg
    None => return
  }
  let value_arg = match args.get("value") {
    Some(arg) => arg
    None => return
  }
  let name = match expect_string("config", "name", name_arg, errors) {
    Some(value) => value
    None => return
  }
  guard var_types.get(name) is Some(expected_type) else {
    semantic_error(
      errors,
      call.line,
      call.column,
      "config.name '\{name}' is not declared by var()",
    )
    return
  }
  if not(value_matches_type(value_arg.value, expected_type)) {
    semantic_error(
      errors,
      value_arg.line,
      value_arg.column,
      "config.value for '\{name}' must match type '\{expected_type}'",
    )
    return
  }
  bindings[name] = value_arg.value
  if required_pending.get(name) is Some(_) {
    required_pending[name] = false
  }
}

///|
pub fn parse(text : String) -> StarlarkParseResult {
  parse_with_inputs_impl(text, {})
}

///|
pub fn parse_with_inputs(
  text : String,
  external_inputs : Map[String, String],
) -> StarlarkParseResult {
  parse_with_inputs_impl(text, external_inputs)
}

///|
fn parse_with_inputs_impl(
  text : String,
  external_inputs : Map[String, String],
) -> StarlarkParseResult {
  let syntax = parse_syntax(text)
  parse_calls_impl(syntax.calls, syntax.errors, external_inputs)
}

///|
fn apply_calls(
  calls : Array[StarlarkCall],
  nodes : Array[StarlarkNodeDecl],
  tasks : Array[StarlarkTaskDecl],
  entry_targets : Array[String],
  bindings : Map[String, StarlarkValue],
  var_types : Map[String, String],
  required_pending : Map[String, Bool],
  required_locations : Map[String, (Int, Int)],
  external_inputs : Map[String, String],
  errors : Array[String],
  workflow_name : String,
  max_parallel : Int,
  seen_workflow : Bool,
  functions : Map[String, StarlarkFunctionDecl],
  loop_depth : Int,
  call_stack : Array[String],
) -> (String, Int, Bool, StarlarkControlSignal) {
  let mut current_workflow_name = workflow_name
  let mut current_max_parallel = max_parallel
  let mut current_seen_workflow = seen_workflow

  for call in calls {
    let canonical_name = builtin_canonical_name(call.name)
    match canonical_name {
      "__assign__" =>
        apply_assignment(call, bindings, functions, errors, call_stack~)
      "__if__" => {
        let args = arg_map_resolved(
          call,
          bindings,
          functions,
          errors,
          call_stack~,
        )
        validate_call_shape(call, args, errors)
        let mut selected_branch = ""
        match args.get("cond") {
          Some(arg) =>
            selected_branch = if value_truthy(arg.value) {
              "then"
            } else {
              "else"
            }
          None => ()
        }
        if selected_branch.length() == 0 {
          continue
        }
        match args.get(selected_branch) {
          Some(arg) =>
            match expect_string("__if__", selected_branch, arg, errors) {
              Some(source) => {
                let nested = parse_syntax(source)
                for err in nested.errors {
                  errors.push(err)
                }
                let (next_name, next_parallel, next_seen, signal) = apply_calls(
                  nested.calls,
                  nodes,
                  tasks,
                  entry_targets,
                  bindings,
                  var_types,
                  required_pending,
                  required_locations,
                  external_inputs,
                  errors,
                  current_workflow_name,
                  current_max_parallel,
                  current_seen_workflow,
                  functions,
                  loop_depth,
                  call_stack,
                )
                current_workflow_name = next_name
                current_max_parallel = next_parallel
                current_seen_workflow = next_seen
                match signal {
                  Next => ()
                  _ =>
                    return (
                      current_workflow_name, current_max_parallel, current_seen_workflow,
                      signal,
                    )
                }
              }
              None => ()
            }
          None => ()
        }
      }
      "__for__" => {
        let args = arg_map_resolved(
          call,
          bindings,
          functions,
          errors,
          call_stack~,
        )
        validate_call_shape(call, args, errors)
        let mut iter_line = call.line
        let mut iter_col = call.column
        let mut loop_name = ""
        let mut iterable : StarlarkValue? = None
        let mut body_source = ""
        match args.get("name") {
          Some(arg) =>
            if expect_string("__for__", "name", arg, errors) is Some(value) {
              loop_name = value
            }
          None => ()
        }
        match args.get("iter") {
          Some(arg) => {
            iter_line = arg.line
            iter_col = arg.column
            iterable = Some(arg.value)
          }
          None => ()
        }
        match args.get("body") {
          Some(arg) =>
            if expect_string("__for__", "body", arg, errors) is Some(value) {
              body_source = value
            }
          None => ()
        }
        if loop_name.length() == 0 || body_source.length() == 0 {
          continue
        }
        match iterable {
          Some(iter_value) =>
            match
              iterable_values_for_context(
                iter_value,
                iter_line,
                iter_col,
                errors,
                "for.iter",
                call_stack~,
              ) {
              Some(items) => {
                let nested = parse_syntax(body_source)
                for err in nested.errors {
                  errors.push(err)
                }
                for item in items {
                  bindings[loop_name] = item
                  let (next_name, next_parallel, next_seen, signal) = apply_calls(
                    nested.calls,
                    nodes,
                    tasks,
                    entry_targets,
                    bindings,
                    var_types,
                    required_pending,
                    required_locations,
                    external_inputs,
                    errors,
                    current_workflow_name,
                    current_max_parallel,
                    current_seen_workflow,
                    functions,
                    loop_depth + 1,
                    call_stack,
                  )
                  current_workflow_name = next_name
                  current_max_parallel = next_parallel
                  current_seen_workflow = next_seen
                  match signal {
                    Next => ()
                    BreakLoop => break
                    ContinueLoop => continue
                    ReturnFromBlock(value) =>
                      return (
                        current_workflow_name,
                        current_max_parallel,
                        current_seen_workflow,
                        ReturnFromBlock(value),
                      )
                  }
                }
              }
              None => ()
            }
          None => ()
        }
      }
      "__while__" => {
        let args = arg_map(call, errors)
        validate_call_shape(call, args, errors)
        let mut cond_line = call.line
        let mut cond_col = call.column
        let mut cond_expr : StarlarkValue? = None
        let mut body_source = ""
        match args.get("cond") {
          Some(arg) => {
            cond_line = arg.line
            cond_col = arg.column
            cond_expr = Some(arg.value)
          }
          None => ()
        }
        match args.get("body") {
          Some(arg) =>
            if expect_string("__while__", "body", arg, errors) is Some(value) {
              body_source = value
            }
          None => ()
        }
        if body_source.length() == 0 {
          continue
        }
        let nested = parse_syntax(body_source)
        for err in nested.errors {
          errors.push(err)
        }
        let mut loop_count = 0
        while true {
          if loop_count >= 10000 {
            semantic_error(
              errors, cond_line, cond_col, "while loop exceeded 10000 iterations",
            )
            break
          }
          let should_continue = match cond_expr {
            Some(cond) =>
              match
                resolve_value_with_functions(
                  cond,
                  bindings,
                  functions,
                  cond_line,
                  cond_col,
                  errors,
                  call_stack~,
                ) {
                Some(value) => value_truthy(value)
                None => false
              }
            None => false
          }
          if not(should_continue) {
            break
          }
          let (next_name, next_parallel, next_seen, signal) = apply_calls(
            nested.calls,
            nodes,
            tasks,
            entry_targets,
            bindings,
            var_types,
            required_pending,
            required_locations,
            external_inputs,
            errors,
            current_workflow_name,
            current_max_parallel,
            current_seen_workflow,
            functions,
            loop_depth + 1,
            call_stack,
          )
          current_workflow_name = next_name
          current_max_parallel = next_parallel
          current_seen_workflow = next_seen
          loop_count += 1
          match signal {
            Next => ()
            BreakLoop => break
            ContinueLoop => continue
            ReturnFromBlock(value) =>
              return (
                current_workflow_name,
                current_max_parallel,
                current_seen_workflow,
                ReturnFromBlock(value),
              )
          }
        }
      }
      "__def__" => {
        let args = arg_map_resolved(
          call,
          bindings,
          functions,
          errors,
          call_stack~,
        )
        validate_call_shape(call, args, errors)
        let mut invalid = false
        let mut fn_name = ""
        let mut params : Array[String] = []
        let defaults : Map[String, StarlarkValue] = {}
        let mut body_source = ""
        match args.get("name") {
          Some(arg) =>
            if expect_string("__def__", "name", arg, errors) is Some(value) {
              fn_name = value
            } else {
              invalid = true
            }
          None => invalid = true
        }
        match args.get("params") {
          Some(arg) =>
            if expect_string_list("__def__", "params", arg, errors)
              is Some(value) {
              params = value
            } else {
              invalid = true
            }
          None => invalid = true
        }
        match args.get("defaults") {
          Some(arg) =>
            match arg.value {
              Dict(items) =>
                for key, value in items {
                  if params.contains(key) {
                    defaults[key] = value
                  } else {
                    semantic_error(
                      errors,
                      arg.line,
                      arg.column,
                      "unknown default parameter '\{key}' for function \{fn_name}",
                    )
                    invalid = true
                  }
                }
              _ => {
                semantic_error(
                  errors,
                  arg.line,
                  arg.column,
                  "__def__.defaults must be dict",
                )
                invalid = true
              }
            }
          None => ()
        }
        match args.get("body") {
          Some(arg) =>
            if expect_string("__def__", "body", arg, errors) is Some(value) {
              body_source = value
            } else {
              invalid = true
            }
          None => invalid = true
        }
        let param_seen : Map[String, Bool] = {}
        for param in params {
          if param_seen.get(param) is Some(_) {
            semantic_error(
              errors,
              call.line,
              call.column,
              "duplicate parameter '\{param}' in function \{fn_name}",
            )
            invalid = true
          } else {
            param_seen[param] = true
          }
        }
        if fn_name.length() > 0 && builtin_spec_for(fn_name) is Some(_) {
          semantic_error(
            errors,
            call.line,
            call.column,
            "function name '\{fn_name}' conflicts with builtin statement",
          )
          invalid = true
        }
        if not(invalid) && fn_name.length() > 0 && body_source.length() > 0 {
          functions[fn_name] = { params, defaults, body: body_source }
        }
      }
      "__return__" => {
        let args = arg_map_resolved(
          call,
          bindings,
          functions,
          errors,
          call_stack~,
        )
        validate_call_shape(call, args, errors)
        let return_value = match args.get("value") {
          Some(arg) => arg.value
          None => NoneValue
        }
        return (
          current_workflow_name,
          current_max_parallel,
          current_seen_workflow,
          ReturnFromBlock(return_value),
        )
      }
      "__break__" => {
        let args = arg_map(call, errors)
        validate_call_shape(call, args, errors)
        if loop_depth <= 0 {
          semantic_error(
            errors,
            call.line,
            call.column,
            "break statement is only allowed inside loops",
          )
          continue
        }
        return (
          current_workflow_name,
          current_max_parallel,
          current_seen_workflow,
          BreakLoop,
        )
      }
      "__continue__" => {
        let args = arg_map(call, errors)
        validate_call_shape(call, args, errors)
        if loop_depth <= 0 {
          semantic_error(
            errors,
            call.line,
            call.column,
            "continue statement is only allowed inside loops",
          )
          continue
        }
        return (
          current_workflow_name,
          current_max_parallel,
          current_seen_workflow,
          ContinueLoop,
        )
      }
      "var" => {
        let args = arg_map_resolved(
          call,
          bindings,
          functions,
          errors,
          call_stack~,
        )
        validate_call_shape(call, args, errors)
        apply_var_call(
          call, args, bindings, var_types, required_pending, required_locations,
          external_inputs, errors,
        )
      }
      "config" => {
        let args = arg_map_resolved(
          call,
          bindings,
          functions,
          errors,
          call_stack~,
        )
        validate_call_shape(call, args, errors)
        apply_config_call(
          call, args, bindings, var_types, required_pending, errors,
        )
      }
      "workflow" => {
        if current_seen_workflow {
          semantic_error(
            errors,
            call.line,
            call.column,
            "workflow() can only be declared once",
          )
          continue
        }
        current_seen_workflow = true
        let args = arg_map_resolved(
          call,
          bindings,
          functions,
          errors,
          call_stack~,
        )
        validate_call_shape(call, args, errors)

        match args.get("name") {
          Some(arg) =>
            match expect_string("workflow", "name", arg, errors) {
              Some(name) => current_workflow_name = name
              None => ()
            }
          None => ()
        }

        match args.get("max_parallel") {
          Some(arg) =>
            match expect_int("workflow", "max_parallel", arg, errors) {
              Some(value) =>
                if value > 0 {
                  current_max_parallel = value
                } else {
                  semantic_error(
                    errors,
                    arg.line,
                    arg.column,
                    "workflow.max_parallel must be positive",
                  )
                }
              None => ()
            }
          None => ()
        }
      }
      "node" => {
        let args = arg_map_resolved(
          call,
          bindings,
          functions,
          errors,
          call_stack~,
        )
        validate_call_shape(call, args, errors)
        let mut invalid = false
        let mut id = ""
        let mut depends_on : Array[String] = []
        let mut required = true

        match args.get("id") {
          Some(arg) =>
            if expect_string("node", "id", arg, errors) is Some(value) {
              id = value
            } else {
              invalid = true
            }
          None => invalid = true
        }

        match args.get("depends_on") {
          Some(arg) =>
            if expect_string_list("node", "depends_on", arg, errors)
              is Some(value) {
              depends_on = value
            } else {
              invalid = true
            }
          None => ()
        }

        match args.get("required") {
          Some(arg) =>
            if expect_bool("node", "required", arg, errors) is Some(value) {
              required = value
            } else {
              invalid = true
            }
          None => ()
        }

        if not(invalid) {
          nodes.push({ id, depends_on, required })
        }
      }
      "task" => {
        let args = arg_map_resolved(
          call,
          bindings,
          functions,
          errors,
          call_stack~,
        )
        validate_call_shape(call, args, errors)
        let mut invalid = false
        let mut id = ""
        let mut node_id = ""
        let mut cmd = ""
        let mut needs : Array[String] = []
        let mut required = true
        let mut srcs : Array[String] = []
        let mut outs : Array[String] = []
        let mut env : Map[String, String] = {}
        let mut cwd = ""
        let mut trigger_mode = "auto"

        match args.get("id") {
          Some(arg) =>
            if expect_string("task", "id", arg, errors) is Some(value) {
              id = value
            } else {
              invalid = true
            }
          None => invalid = true
        }

        match args.get("node") {
          Some(arg) =>
            if expect_string("task", "node", arg, errors) is Some(value) {
              node_id = value
            } else {
              invalid = true
            }
          None => invalid = true
        }

        match args.get("cmd") {
          Some(arg) =>
            if expect_task_cmd(arg, errors) is Some(value) {
              cmd = value
            } else {
              invalid = true
            }
          None => invalid = true
        }

        match args.get("needs") {
          Some(arg) =>
            if expect_string_list("task", "needs", arg, errors) is Some(value) {
              needs = value
            } else {
              invalid = true
            }
          None => ()
        }

        match args.get("required") {
          Some(arg) =>
            if expect_bool("task", "required", arg, errors) is Some(value) {
              required = value
            } else {
              invalid = true
            }
          None => ()
        }

        match args.get("srcs") {
          Some(arg) =>
            if expect_string_list("task", "srcs", arg, errors) is Some(value) {
              srcs = value
            } else {
              invalid = true
            }
          None => ()
        }

        match args.get("outs") {
          Some(arg) =>
            if expect_string_list("task", "outs", arg, errors) is Some(value) {
              outs = value
            } else {
              invalid = true
            }
          None => ()
        }

        match args.get("env") {
          Some(arg) =>
            if expect_string_dict("task", "env", arg, errors) is Some(value) {
              env = value
            } else {
              invalid = true
            }
          None => ()
        }

        match args.get("cwd") {
          Some(arg) =>
            if expect_string("task", "cwd", arg, errors) is Some(value) {
              cwd = value
            } else {
              invalid = true
            }
          None => ()
        }

        match args.get("trigger") {
          Some(arg) =>
            if expect_trigger_mode(arg, errors) is Some(value) {
              trigger_mode = value
            } else {
              invalid = true
            }
          None => ()
        }

        if not(invalid) {
          tasks.push({
            id,
            node: node_id,
            cmd,
            needs,
            required,
            srcs,
            outs,
            env,
            cwd,
            trigger_mode,
          })
        }
      }
      "entrypoint" => {
        let args = arg_map_resolved(
          call,
          bindings,
          functions,
          errors,
          call_stack~,
        )
        validate_call_shape(call, args, errors)
        match args.get("targets") {
          Some(arg) =>
            if expect_string_list("entrypoint", "targets", arg, errors)
              is Some(targets) {
              for target in targets {
                entry_targets.push(target)
              }
            }
          None => ()
        }
      }
      "load" =>
        semantic_error(
          errors,
          call.line,
          call.column,
          "load() is only supported when parsing from fs",
        )
      _ =>
        match functions.get(canonical_name) {
          Some(fn_decl) => {
            let args = arg_map_resolved(
              call,
              bindings,
              functions,
              errors,
              call_stack~,
            )
            let positional_values : Array[StarlarkValue] = []
            let keyword_values : Map[String, StarlarkValue] = {}
            for arg in call.args {
              match args.get(arg.name) {
                Some(value) =>
                  if is_positional_arg_name(arg.name) {
                    positional_values.push(value.value)
                  } else {
                    keyword_values[arg.name] = value.value
                  }
                None => ()
              }
            }
            let nested_call_stack : Array[String] = []
            for item in call_stack {
              nested_call_stack.push(item)
            }
            nested_call_stack.push(canonical_name)
            if nested_call_stack.length() > FUNCTION_CALL_MAX_DEPTH {
              semantic_error_with_stack(
                errors,
                call.line,
                call.column,
                "function call depth exceeded \{FUNCTION_CALL_MAX_DEPTH}",
                nested_call_stack,
              )
              continue
            }
            let bound_args = match
              bind_function_args(
                canonical_name,
                fn_decl,
                positional_values,
                keyword_values,
                call.line,
                call.column,
                errors,
                nested_call_stack,
              ) {
              Some(values) => values
              None => continue
            }
            let local_bindings = copy_bindings(bindings)
            for key, value in bound_args {
              local_bindings[key] = value
            }
            let nested = parse_syntax(fn_decl.body)
            for err in nested.errors {
              errors.push(err)
            }
            let local_functions = copy_functions(functions)
            let (next_name, next_parallel, next_seen, signal) = apply_calls(
              nested.calls,
              nodes,
              tasks,
              entry_targets,
              local_bindings,
              var_types,
              required_pending,
              required_locations,
              external_inputs,
              errors,
              current_workflow_name,
              current_max_parallel,
              current_seen_workflow,
              local_functions,
              0,
              nested_call_stack,
            )
            current_workflow_name = next_name
            current_max_parallel = next_parallel
            current_seen_workflow = next_seen
            match signal {
              Next => ()
              ReturnFromBlock(_) => ()
              BreakLoop => ()
              ContinueLoop => ()
            }
          }
          None =>
            semantic_error(
              errors,
              call.line,
              call.column,
              "unknown statement: \{call.name}",
            )
        }
    }
  }

  (current_workflow_name, current_max_parallel, current_seen_workflow, Next)
}

///|
fn parse_calls_impl(
  calls : Array[StarlarkCall],
  syntax_errors : Array[String],
  external_inputs : Map[String, String],
) -> StarlarkParseResult {
  let errors : Array[String] = []
  for err in syntax_errors {
    errors.push(err)
  }

  let nodes : Array[StarlarkNodeDecl] = []
  let tasks : Array[StarlarkTaskDecl] = []
  let entry_targets : Array[String] = []
  let mut workflow_name = "default"
  let mut max_parallel = 1
  let seen_workflow = false
  let bindings : Map[String, StarlarkValue] = {}
  let var_types : Map[String, String] = {}
  let required_pending : Map[String, Bool] = {}
  let required_locations : Map[String, (Int, Int)] = {}
  let functions : Map[String, StarlarkFunctionDecl] = {}

  let (resolved_workflow_name, resolved_max_parallel, _, _) = apply_calls(
    calls,
    nodes,
    tasks,
    entry_targets,
    bindings,
    var_types,
    required_pending,
    required_locations,
    external_inputs,
    errors,
    workflow_name,
    max_parallel,
    seen_workflow,
    functions,
    0,
    [],
  )
  workflow_name = resolved_workflow_name
  max_parallel = resolved_max_parallel

  for name, is_pending in required_pending {
    if is_pending {
      let (line, column) = required_locations.get(name).unwrap_or((1, 1))
      semantic_error(
        errors,
        line,
        column,
        "required var '\{name}' must be provided by config() or external inputs",
      )
    }
  }
  for key, _ in external_inputs {
    if var_types.get(key) is None {
      errors.push("external input '\{key}' is not declared by var()")
    }
  }

  {
    workflow: { name: workflow_name, max_parallel, nodes, tasks, entry_targets },
    errors,
  }
}
