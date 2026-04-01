///|
priv enum StarlarkValue {
  Str(String)
  Num(Int)
  Bool(Bool)
  NoneValue
  List(Array[StarlarkValue])
  ListComp(StarlarkValue, String, StarlarkValue, StarlarkValue?)
  Dict(Map[String, StarlarkValue])
  DictComp(StarlarkValue, StarlarkValue, String, StarlarkValue, StarlarkValue?)
  Ref(String)
  Neg(StarlarkValue)
  Index(StarlarkValue, StarlarkValue)
  Slice(StarlarkValue, StarlarkValue?, StarlarkValue?, StarlarkValue?)
  MethodCall(StarlarkValue, String, Array[StarlarkValue])
  CallKwArg(String, StarlarkValue)
  Call(String, Array[StarlarkValue])
  Add(StarlarkValue, StarlarkValue)
  Sub(StarlarkValue, StarlarkValue)
  Mul(StarlarkValue, StarlarkValue)
  FloorDiv(StarlarkValue, StarlarkValue)
  Mod(StarlarkValue, StarlarkValue)
  Eq(StarlarkValue, StarlarkValue)
  NotEq(StarlarkValue, StarlarkValue)
  Lt(StarlarkValue, StarlarkValue)
  Lte(StarlarkValue, StarlarkValue)
  Gt(StarlarkValue, StarlarkValue)
  Gte(StarlarkValue, StarlarkValue)
  In(StarlarkValue, StarlarkValue)
  NotIn(StarlarkValue, StarlarkValue)
  Not(StarlarkValue)
  And(StarlarkValue, StarlarkValue)
  Or(StarlarkValue, StarlarkValue)
  IfExpr(StarlarkValue, StarlarkValue, StarlarkValue)
}

///|
priv enum StarlarkCompareOp {
  Eq
  NotEq
  Lt
  Lte
  Gt
  Gte
  In
  NotIn
}

///|
priv struct StarlarkArg {
  name : String
  value : StarlarkValue
  line : Int
  column : Int
}

///|
priv struct StarlarkCall {
  name : String
  args : Array[StarlarkArg]
  line : Int
  column : Int
}

///|
priv struct StarlarkSyntaxResult {
  calls : Array[StarlarkCall]
  errors : Array[String]
}

///|
priv struct StarlarkParser {
  text : String
  mut idx : Int
  mut line : Int
  mut column : Int
  mut skip_statement_end_once : Bool
  errors : Array[String]
}

///|
fn parser_new(text : String) -> StarlarkParser {
  {
    text,
    idx: 0,
    line: 1,
    column: 1,
    skip_statement_end_once: false,
    errors: [],
  }
}

///|
fn StarlarkParser::peek(self : StarlarkParser) -> UInt16? {
  if self.idx >= self.text.length() {
    None
  } else {
    Some(self.text.unsafe_get(self.idx))
  }
}

///|
fn StarlarkParser::advance(self : StarlarkParser) -> UInt16? {
  guard self.idx < self.text.length() else { return None }
  let ch = self.text.unsafe_get(self.idx)
  self.idx += 1
  if ch == '\n' {
    self.line += 1
    self.column = 1
  } else {
    self.column += 1
  }
  Some(ch)
}

///|
fn StarlarkParser::consume_char(self : StarlarkParser, ch : UInt16) -> Bool {
  match self.peek() {
    Some(next) if next == ch => {
      self.advance() |> ignore
      true
    }
    _ => false
  }
}

///|
fn StarlarkParser::consume_two_chars(
  self : StarlarkParser,
  ch1 : UInt16,
  ch2 : UInt16,
) -> Bool {
  guard self.idx + 1 < self.text.length() else { return false }
  guard self.text.unsafe_get(self.idx) == ch1 else { return false }
  guard self.text.unsafe_get(self.idx + 1) == ch2 else { return false }
  self.advance() |> ignore
  self.advance() |> ignore
  true
}

///|
fn StarlarkParser::consume_keyword(
  self : StarlarkParser,
  keyword : String,
) -> Bool {
  let saved_idx = self.idx
  let saved_line = self.line
  let saved_col = self.column
  match self.parse_identifier() {
    Some(ident) if ident == keyword => true
    _ => {
      self.idx = saved_idx
      self.line = saved_line
      self.column = saved_col
      false
    }
  }
}

///|
fn StarlarkParser::consume_not_in_operator(self : StarlarkParser) -> Bool {
  let saved_idx = self.idx
  let saved_line = self.line
  let saved_col = self.column
  if self.consume_keyword("not") {
    self.skip_inline_space()
    if self.consume_keyword("in") {
      return true
    }
  }
  self.idx = saved_idx
  self.line = saved_line
  self.column = saved_col
  false
}

///|
fn is_digit(ch : UInt16) -> Bool {
  ch >= '0' && ch <= '9'
}

///|
fn is_ident_start(ch : UInt16) -> Bool {
  (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch == '_'
}

///|
fn is_ident_part(ch : UInt16) -> Bool {
  is_ident_start(ch) || is_digit(ch)
}

///|
fn is_inline_space(ch : UInt16) -> Bool {
  ch == ' ' || ch == '\t' || ch == '\r'
}

///|
fn StarlarkParser::push_error(self : StarlarkParser, msg : String) -> Unit {
  self.errors.push("line \{self.line}, col \{self.column}: " + msg)
}

///|
fn StarlarkParser::skip_inline_space(self : StarlarkParser) -> Unit {
  while self.peek() is Some(ch) {
    if is_inline_space(ch) {
      self.advance() |> ignore
    } else {
      break
    }
  }
}

///|
fn StarlarkParser::skip_comment(self : StarlarkParser) -> Unit {
  if not(self.consume_char('#')) {
    return
  }
  while self.peek() is Some(ch) {
    if ch == '\n' {
      break
    }
    self.advance() |> ignore
  }
}

///|
fn StarlarkParser::skip_statement_separators(self : StarlarkParser) -> Unit {
  while true {
    let mut progressed = false
    while self.peek() is Some(ch) {
      if is_inline_space(ch) || ch == '\n' || ch == ';' {
        self.advance() |> ignore
        progressed = true
      } else {
        break
      }
    }
    if self.peek() is Some('#') {
      self.skip_comment()
      progressed = true
    }
    if not(progressed) {
      break
    }
  }
}

///|
fn StarlarkParser::skip_value_space(self : StarlarkParser) -> Unit {
  while true {
    let mut progressed = false
    while self.peek() is Some(ch) {
      if is_inline_space(ch) || ch == '\n' {
        self.advance() |> ignore
        progressed = true
      } else {
        break
      }
    }
    if self.peek() is Some('#') {
      self.skip_comment()
      progressed = true
    }
    if not(progressed) {
      break
    }
  }
}

///|
fn StarlarkParser::parse_identifier(self : StarlarkParser) -> String? {
  guard self.peek() is Some(ch) && is_ident_start(ch) else { return None }
  let start = self.idx
  self.advance() |> ignore
  while self.peek() is Some(next) {
    if is_ident_part(next) {
      self.advance() |> ignore
    } else {
      break
    }
  }
  Some(String::unsafe_substring(self.text, start~, end=self.idx))
}

///|
fn StarlarkParser::parse_string(self : StarlarkParser) -> StarlarkValue? {
  guard self.peek() is Some(quote) else {
    self.push_error("expected string literal")
    return None
  }
  guard quote == '"' || quote.to_int() == 39 else {
    self.push_error("expected string literal")
    return None
  }
  self.advance() |> ignore
  let buf = StringBuilder::new()
  let mut escaped = false
  while self.peek() is Some(ch) {
    self.advance() |> ignore
    if escaped {
      escaped = false
      if ch == 'n' {
        buf.write_char('\n')
      } else if ch == 'r' {
        buf.write_char('\r')
      } else if ch == 't' {
        buf.write_char('\t')
      } else if ch == '\\' {
        buf.write_char('\\')
      } else if ch == '"' {
        buf.write_char('"')
      } else if ch.to_int() == 39 {
        buf.write_char(ch.unsafe_to_char())
      } else {
        self.push_error("invalid escape sequence")
        buf.write_char(ch.unsafe_to_char())
      }
      continue
    }
    if ch == '\\' {
      escaped = true
      continue
    }
    if ch == '\n' {
      self.push_error("unexpected newline in string literal")
      return None
    }
    if ch == quote {
      return Some(Str(buf.to_string()))
    }
    buf.write_char(ch.unsafe_to_char())
  }
  self.push_error("unterminated string literal")
  None
}

///|
fn StarlarkParser::parse_int(self : StarlarkParser) -> StarlarkValue? {
  guard self.peek() is Some(first) && is_digit(first) else {
    self.push_error("expected integer literal")
    return None
  }
  let mut value = 0
  while self.peek() is Some(ch) {
    if is_digit(ch) {
      self.advance() |> ignore
      value = value * 10 + (ch.to_int() - '0'.to_int())
    } else {
      break
    }
  }
  Some(Num(value))
}

///|
fn StarlarkParser::recover_to_arg_boundary(self : StarlarkParser) -> Unit {
  while self.peek() is Some(ch) {
    if ch == ',' || ch == ')' || ch == ']' || ch == '}' {
      break
    }
    self.advance() |> ignore
  }
}

///|
fn StarlarkParser::parse_list(self : StarlarkParser) -> StarlarkValue? {
  guard self.consume_char('[') else {
    self.push_error("expected '['")
    return None
  }
  let items : Array[StarlarkValue] = []
  self.skip_value_space()
  if self.consume_char(']') {
    return Some(List(items))
  }
  self.skip_value_space()
  let first_item = match self.parse_value() {
    Some(value) => value
    None => {
      self.recover_to_arg_boundary()
      if self.consume_char(']') {
        return Some(List(items))
      }
      return None
    }
  }
  self.skip_value_space()
  if self.consume_keyword("for") {
    self.skip_value_space()
    let loop_name = match self.parse_identifier() {
      Some(name) => name
      None => {
        self.push_error("list comprehension requires loop variable name")
        return None
      }
    }
    self.skip_value_space()
    if not(self.consume_keyword("in")) {
      self.push_error("list comprehension requires 'in'")
      return None
    }
    self.skip_value_space()
    let iter_expr = match self.parse_or_value() {
      Some(value) => value
      None => return None
    }
    self.skip_value_space()
    let mut cond_expr : StarlarkValue? = None
    if self.consume_keyword("if") {
      self.skip_value_space()
      cond_expr = self.parse_value()
      if cond_expr is None {
        return None
      }
      self.skip_value_space()
    }
    if not(self.consume_char(']')) {
      self.push_error("expected ']' to close list comprehension")
      return None
    }
    return Some(ListComp(first_item, loop_name, iter_expr, cond_expr))
  }
  items.push(first_item)
  while true {
    self.skip_value_space()
    if self.consume_char(',') {
      self.skip_value_space()
      if self.consume_char(']') {
        break
      }
      match self.parse_value() {
        Some(value) => items.push(value)
        None => {
          self.recover_to_arg_boundary()
          if self.consume_char(']') {
            break
          }
          if self.consume_char(',') {
            continue
          }
          break
        }
      }
      continue
    }
    if self.consume_char(']') {
      break
    }
    self.push_error("expected ',' or ']' in list literal")
    self.recover_to_arg_boundary()
    if self.consume_char(']') {
      break
    }
    if self.consume_char(',') {
      continue
    }
    break
  }
  Some(List(items))
}

///|
fn StarlarkParser::parse_dict(self : StarlarkParser) -> StarlarkValue? {
  guard self.consume_char('{') else {
    self.push_error("expected '{'")
    return None
  }
  let items : Map[String, StarlarkValue] = {}
  self.skip_value_space()
  if self.consume_char('}') {
    return Some(Dict(items))
  }
  self.skip_value_space()
  let first_key_expr = match self.parse_value() {
    Some(value) => value
    None => {
      self.recover_to_arg_boundary()
      if self.consume_char('}') {
        return Some(Dict(items))
      }
      return None
    }
  }

  self.skip_value_space()
  if not(self.consume_char(':')) {
    self.push_error("expected ':' after dict key")
    self.recover_to_arg_boundary()
    if self.consume_char('}') {
      return Some(Dict(items))
    }
    return None
  }

  self.skip_value_space()
  let first_value_expr = match self.parse_value() {
    Some(value) => value
    None => {
      self.recover_to_arg_boundary()
      if self.consume_char('}') {
        return Some(Dict(items))
      }
      return None
    }
  }

  self.skip_value_space()
  if self.consume_keyword("for") {
    self.skip_value_space()
    let loop_name = match self.parse_identifier() {
      Some(name) => name
      None => {
        self.push_error("dict comprehension requires loop variable name")
        return None
      }
    }
    self.skip_value_space()
    if not(self.consume_keyword("in")) {
      self.push_error("dict comprehension requires 'in'")
      return None
    }
    self.skip_value_space()
    let iter_expr = match self.parse_or_value() {
      Some(value) => value
      None => return None
    }
    self.skip_value_space()
    let mut cond_expr : StarlarkValue? = None
    if self.consume_keyword("if") {
      self.skip_value_space()
      cond_expr = self.parse_value()
      if cond_expr is None {
        return None
      }
      self.skip_value_space()
    }
    if not(self.consume_char('}')) {
      self.push_error("expected '}' to close dict comprehension")
      return None
    }
    return Some(
      DictComp(
        first_key_expr, first_value_expr, loop_name, iter_expr, cond_expr,
      ),
    )
  }

  match first_key_expr {
    Str(text) => items[text] = first_value_expr
    _ => self.push_error("dict key must be string")
  }
  while true {
    if self.consume_char(',') {
      self.skip_value_space()
      if self.consume_char('}') {
        break
      }
      let key = match self.parse_string() {
        Some(Str(text)) => text
        _ => {
          self.push_error("dict key must be string")
          self.recover_to_arg_boundary()
          if self.consume_char('}') {
            break
          }
          if self.consume_char(',') {
            continue
          }
          break
        }
      }

      self.skip_value_space()
      if not(self.consume_char(':')) {
        self.push_error("expected ':' after dict key")
        self.recover_to_arg_boundary()
        if self.consume_char('}') {
          break
        }
        if self.consume_char(',') {
          continue
        }
        break
      }

      self.skip_value_space()
      match self.parse_value() {
        Some(value) => items[key] = value
        None => {
          self.recover_to_arg_boundary()
          if self.consume_char('}') {
            break
          }
          if self.consume_char(',') {
            continue
          }
          break
        }
      }
      continue
    }
    if self.consume_char('}') {
      break
    }
    self.push_error("expected ',' or '}' in dict literal")
    self.recover_to_arg_boundary()
    if self.consume_char('}') {
      break
    }
    if self.consume_char(',') {
      continue
    }
    break
  }
  Some(Dict(items))
}

///|
fn parse_identifier_value(ident : String) -> StarlarkValue? {
  if ident == "True" || ident == "true" {
    Some(Bool(true))
  } else if ident == "False" || ident == "false" {
    Some(Bool(false))
  } else if ident == "None" {
    Some(NoneValue)
  } else {
    Some(Ref(ident))
  }
}

///|
fn StarlarkParser::parse_primary_value(self : StarlarkParser) -> StarlarkValue? {
  self.skip_value_space()
  guard self.peek() is Some(ch) else {
    self.push_error("expected value")
    return None
  }
  if ch == '"' || ch.to_int() == 39 {
    return self.parse_string()
  }
  if ch == '[' {
    return self.parse_list()
  }
  if ch == '{' {
    return self.parse_dict()
  }
  if ch == '(' {
    self.advance() |> ignore
    self.skip_value_space()
    if self.consume_char(')') {
      return Some(List([]))
    }
    match self.parse_value() {
      Some(first) => {
        self.skip_value_space()
        if self.consume_char(',') {
          let items : Array[StarlarkValue] = [first]
          while true {
            self.skip_value_space()
            if self.consume_char(')') {
              return Some(List(items))
            }
            match self.parse_value() {
              Some(value) => items.push(value)
              None => {
                self.skip_value_space()
                if not(self.consume_char(')')) {
                  self.push_error("expected ')' to close expression")
                }
                return None
              }
            }
            self.skip_value_space()
            if self.consume_char(',') {
              continue
            }
            if self.consume_char(')') {
              return Some(List(items))
            }
            self.push_error("expected ')' to close expression")
            return None
          }
        }
        if not(self.consume_char(')')) {
          self.push_error("expected ')' to close expression")
          return None
        }
        return Some(first)
      }
      None => {
        self.skip_value_space()
        if not(self.consume_char(')')) {
          self.push_error("expected ')' to close expression")
        }
        return None
      }
    }
  }
  if is_digit(ch) {
    return self.parse_int()
  }
  if is_ident_start(ch) {
    guard self.parse_identifier() is Some(ident) else {
      self.push_error("expected value")
      return None
    }
    self.skip_inline_space()
    if self.consume_char('(') {
      return self.parse_expr_call_with_name(ident)
    }
    return parse_identifier_value(ident)
  }
  self.push_error("unexpected token while parsing value")
  None
}

///|
fn StarlarkParser::parse_value(self : StarlarkParser) -> StarlarkValue? {
  self.parse_if_value()
}

///|
fn StarlarkParser::parse_if_value(self : StarlarkParser) -> StarlarkValue? {
  guard self.parse_or_value() is Some(then_value) else { return None }
  self.skip_inline_space()
  if not(self.consume_keyword("if")) {
    return Some(then_value)
  }
  guard self.parse_or_value() is Some(cond_value) else { return None }
  self.skip_inline_space()
  if not(self.consume_keyword("else")) {
    self.push_error("expected 'else' in conditional expression")
    return None
  }
  guard self.parse_if_value() is Some(else_value) else { return None }
  Some(IfExpr(cond_value, then_value, else_value))
}

///|
fn StarlarkParser::parse_or_value(self : StarlarkParser) -> StarlarkValue? {
  guard self.parse_and_value() is Some(first) else { return None }
  let mut value = first
  while true {
    self.skip_inline_space()
    if not(self.consume_keyword("or")) {
      break
    }
    match self.parse_and_value() {
      Some(rhs) => value = Or(value, rhs)
      None => return None
    }
  }
  Some(value)
}

///|
fn StarlarkParser::parse_and_value(self : StarlarkParser) -> StarlarkValue? {
  guard self.parse_not_value() is Some(first) else { return None }
  let mut value = first
  while true {
    self.skip_inline_space()
    if not(self.consume_keyword("and")) {
      break
    }
    match self.parse_not_value() {
      Some(rhs) => value = And(value, rhs)
      None => return None
    }
  }
  Some(value)
}

///|
fn StarlarkParser::parse_not_value(self : StarlarkParser) -> StarlarkValue? {
  self.skip_inline_space()
  if self.consume_keyword("not") {
    match self.parse_not_value() {
      Some(value) => return Some(Not(value))
      None => return None
    }
  }
  self.parse_compare_value()
}

///|
fn StarlarkParser::parse_compare_value(self : StarlarkParser) -> StarlarkValue? {
  guard self.parse_add_value() is Some(first) else { return None }
  guard self.parse_compare_op() is Some(first_op) else { return Some(first) }
  guard self.parse_add_value() is Some(second) else { return None }

  let mut chain_expr = compare_expr(first_op, first, second)
  let mut prev_rhs = second
  while self.parse_compare_op() is Some(next_op) {
    guard self.parse_add_value() is Some(next_rhs) else { return None }
    let next_expr = compare_expr(next_op, prev_rhs, next_rhs)
    chain_expr = And(chain_expr, next_expr)
    prev_rhs = next_rhs
  }
  Some(chain_expr)
}

///|
fn StarlarkParser::parse_add_value(self : StarlarkParser) -> StarlarkValue? {
  guard self.parse_mul_value() is Some(first) else { return None }
  let mut value = first
  while true {
    self.skip_inline_space()
    if self.consume_char('+') {
      match self.parse_mul_value() {
        Some(rhs) => value = Add(value, rhs)
        None => return None
      }
      continue
    }
    if self.consume_char('-') {
      match self.parse_mul_value() {
        Some(rhs) => value = Sub(value, rhs)
        None => return None
      }
      continue
    }
    break
  }
  Some(value)
}

///|
fn StarlarkParser::parse_mul_value(self : StarlarkParser) -> StarlarkValue? {
  guard self.parse_unary_value() is Some(first) else { return None }
  let mut value = first
  while true {
    self.skip_inline_space()
    if self.consume_two_chars('/', '/') {
      match self.parse_unary_value() {
        Some(rhs) => value = FloorDiv(value, rhs)
        None => return None
      }
      continue
    }
    if self.consume_char('*') {
      match self.parse_unary_value() {
        Some(rhs) => value = Mul(value, rhs)
        None => return None
      }
      continue
    }
    if self.consume_char('%') {
      match self.parse_unary_value() {
        Some(rhs) => value = Mod(value, rhs)
        None => return None
      }
      continue
    }
    break
  }
  Some(value)
}

///|
fn StarlarkParser::parse_unary_value(self : StarlarkParser) -> StarlarkValue? {
  self.skip_inline_space()
  if self.consume_char('-') {
    match self.parse_unary_value() {
      Some(value) => Some(Neg(value))
      None => None
    }
  } else {
    self.parse_postfix_value()
  }
}

///|
fn StarlarkParser::parse_postfix_value(self : StarlarkParser) -> StarlarkValue? {
  guard self.parse_primary_value() is Some(first) else { return None }
  let mut value = first
  while true {
    self.skip_inline_space()
    if self.consume_char('.') {
      self.skip_value_space()
      guard self.parse_identifier() is Some(method_name) else {
        self.push_error("expected method name after '.'")
        return None
      }
      self.skip_value_space()
      if not(self.consume_char('(')) {
        self.push_error("expected '(' after method name")
        return None
      }
      match self.parse_method_call_with_receiver(value, method_name) {
        Some(next_value) => {
          value = next_value
          continue
        }
        None => return None
      }
    }
    if not(self.consume_char('[')) {
      break
    }
    self.skip_value_space()
    if self.consume_char(':') {
      let (ok, end_bound) = self.parse_slice_bound_optional()
      if not(ok) {
        self.skip_value_space()
        if not(self.consume_char(']')) {
          self.push_error("expected ']' to close slice expression")
        }
        return None
      }
      let mut step_bound : StarlarkValue? = None
      self.skip_value_space()
      if self.consume_char(':') {
        let (step_ok, parsed_step) = self.parse_slice_bound_optional()
        if not(step_ok) {
          self.skip_value_space()
          if not(self.consume_char(']')) {
            self.push_error("expected ']' to close slice expression")
          }
          return None
        }
        step_bound = parsed_step
      }
      self.skip_value_space()
      if not(self.consume_char(']')) {
        self.push_error("expected ']' to close slice expression")
        return None
      }
      value = Slice(value, None, end_bound, step_bound)
      continue
    }

    let first_part = match self.parse_value() {
      Some(parsed) => parsed
      None => {
        self.skip_value_space()
        if not(self.consume_char(']')) {
          self.push_error("expected ']' to close index expression")
        }
        return None
      }
    }
    self.skip_value_space()
    if self.consume_char(':') {
      let (ok, end_bound) = self.parse_slice_bound_optional()
      if not(ok) {
        self.skip_value_space()
        if not(self.consume_char(']')) {
          self.push_error("expected ']' to close slice expression")
        }
        return None
      }
      let mut step_bound : StarlarkValue? = None
      self.skip_value_space()
      if self.consume_char(':') {
        let (step_ok, parsed_step) = self.parse_slice_bound_optional()
        if not(step_ok) {
          self.skip_value_space()
          if not(self.consume_char(']')) {
            self.push_error("expected ']' to close slice expression")
          }
          return None
        }
        step_bound = parsed_step
      }
      self.skip_value_space()
      if not(self.consume_char(']')) {
        self.push_error("expected ']' to close slice expression")
        return None
      }
      value = Slice(value, Some(first_part), end_bound, step_bound)
      continue
    } else {
      if not(self.consume_char(']')) {
        self.push_error("expected ']' to close index expression")
        return None
      }
      value = Index(value, first_part)
    }
  }
  Some(value)
}

///|
fn StarlarkParser::parse_method_call_with_receiver(
  self : StarlarkParser,
  receiver : StarlarkValue,
  name : String,
) -> StarlarkValue? {
  let args : Array[StarlarkValue] = []
  self.skip_value_space()
  if self.consume_char(')') {
    return Some(MethodCall(receiver, name, args))
  }
  while true {
    match self.parse_value() {
      Some(value) => args.push(value)
      None => {
        self.recover_to_arg_boundary()
        if self.consume_char(')') {
          break
        }
        if self.consume_char(',') {
          continue
        }
        break
      }
    }
    self.skip_value_space()
    if self.peek() is Some('=') {
      self.push_error("keyword argument must have form name=expr")
      self.recover_to_arg_boundary()
      if self.consume_char(')') {
        break
      }
      if self.consume_char(',') {
        continue
      }
      break
    }
    if self.consume_char(',') {
      self.skip_value_space()
      if self.consume_char(')') {
        break
      }
      continue
    }
    if self.consume_char(')') {
      break
    }
    self.push_error("expected ',' or ')' in call expression")
    self.recover_to_arg_boundary()
    if self.consume_char(')') {
      break
    }
    if self.consume_char(',') {
      continue
    }
    break
  }
  Some(MethodCall(receiver, name, args))
}

///|
fn StarlarkParser::parse_slice_bound_optional(
  self : StarlarkParser,
) -> (Bool, StarlarkValue?) {
  self.skip_value_space()
  if self.peek() is Some(']') || self.peek() is Some(':') {
    return (true, None)
  }
  match self.parse_value() {
    Some(value) => (true, Some(value))
    None => (false, None)
  }
}

///|
fn StarlarkParser::parse_expr_call_with_name(
  self : StarlarkParser,
  name : String,
) -> StarlarkValue? {
  let args : Array[StarlarkValue] = []
  let mut seen_keyword = false
  self.skip_value_space()
  if self.consume_char(')') {
    return Some(Call(name, args))
  }
  while true {
    self.skip_value_space()
    if self.peek() is None {
      self.push_error("expected ')' to close argument list")
      break
    }
    let saved_idx = self.idx
    let saved_line = self.line
    let saved_col = self.column
    let mut parsed_keyword = false
    if self.parse_identifier() is Some(arg_name) {
      self.skip_value_space()
      if self.consume_char('=') {
        parsed_keyword = true
        seen_keyword = true
        match self.parse_value() {
          Some(value) => args.push(CallKwArg(arg_name, value))
          None => {
            self.recover_to_arg_boundary()
            if self.consume_char(')') {
              break
            }
            if self.consume_char(',') {
              continue
            }
            break
          }
        }
      } else {
        self.idx = saved_idx
        self.line = saved_line
        self.column = saved_col
      }
    } else {
      self.idx = saved_idx
      self.line = saved_line
      self.column = saved_col
    }
    if not(parsed_keyword) {
      if seen_keyword {
        self.push_error("positional argument cannot follow keyword argument")
        self.recover_to_arg_boundary()
        if self.consume_char(')') {
          break
        }
        if self.consume_char(',') {
          continue
        }
        break
      }
      match self.parse_value() {
        Some(value) => args.push(value)
        None => {
          self.recover_to_arg_boundary()
          if self.consume_char(')') {
            break
          }
          if self.consume_char(',') {
            continue
          }
          break
        }
      }
    }
    self.skip_value_space()
    if self.peek() is Some('=') {
      self.push_error("keyword argument must have form name=expr")
      self.recover_to_arg_boundary()
      if self.consume_char(')') {
        break
      }
      if self.consume_char(',') {
        continue
      }
      break
    }
    if self.consume_char(',') {
      self.skip_value_space()
      if self.consume_char(')') {
        break
      }
      continue
    }
    if self.consume_char(')') {
      break
    }
    self.push_error("expected ',' or ')' in call expression")
    self.recover_to_arg_boundary()
    if self.consume_char(')') {
      break
    }
    if self.consume_char(',') {
      continue
    }
    break
  }
  Some(Call(name, args))
}

///|
fn compare_expr(
  op : StarlarkCompareOp,
  left : StarlarkValue,
  right : StarlarkValue,
) -> StarlarkValue {
  match op {
    Eq => Eq(left, right)
    NotEq => NotEq(left, right)
    Lt => Lt(left, right)
    Lte => Lte(left, right)
    Gt => Gt(left, right)
    Gte => Gte(left, right)
    In => In(left, right)
    NotIn => NotIn(left, right)
  }
}

///|
fn StarlarkParser::parse_compare_op(
  self : StarlarkParser,
) -> StarlarkCompareOp? {
  self.skip_inline_space()
  if self.consume_two_chars('=', '=') {
    return Some(Eq)
  }
  if self.consume_two_chars('!', '=') {
    return Some(NotEq)
  }
  if self.consume_two_chars('<', '=') {
    return Some(Lte)
  }
  if self.consume_two_chars('>', '=') {
    return Some(Gte)
  }
  if self.consume_char('<') {
    return Some(Lt)
  }
  if self.consume_char('>') {
    return Some(Gt)
  }
  if self.consume_not_in_operator() {
    return Some(NotIn)
  }
  if self.consume_keyword("in") {
    return Some(In)
  }
  None
}

///|
fn StarlarkParser::parse_load_path_arg(
  self : StarlarkParser,
  args : Array[StarlarkArg],
) -> Bool {
  let arg_line = self.line
  let arg_col = self.column
  if self.peek() is Some(ch) && (ch == '"' || ch.to_int() == 39) {
    match self.parse_string() {
      Some(value) => {
        args.push({ name: "path", value, line: arg_line, column: arg_col })
        return true
      }
      None => return false
    }
  }
  guard self.parse_identifier() is Some(arg_name) else {
    self.push_error("load() first argument must be string path or path=\"...\"")
    return false
  }
  self.skip_value_space()
  if not(self.consume_char('=')) {
    self.push_error("load() first argument must be string path or path=\"...\"")
    return false
  }
  if arg_name != "path" {
    self.push_error("load() first argument must be string path or path=\"...\"")
    self.skip_value_space()
    ignore(self.parse_value())
    return false
  }
  self.skip_value_space()
  match self.parse_string() {
    Some(value) => {
      args.push({ name: "path", value, line: arg_line, column: arg_col })
      true
    }
    None => false
  }
}

///|
fn StarlarkParser::parse_load_import_arg(
  self : StarlarkParser,
) -> (String, String)? {
  if self.peek() is Some(ch) && (ch == '"' || ch.to_int() == 39) {
    return match self.parse_string() {
      Some(Str(name)) => Some((name, name))
      Some(_) => None
      None => None
    }
  }
  if self.peek() is Some('*') {
    self.push_error("splat arguments are not supported")
    return None
  }
  guard self.parse_identifier() is Some(alias_name) else {
    self.push_error("load() import must be string or alias=\"symbol\"")
    return None
  }
  self.skip_value_space()
  if not(self.consume_char('=')) {
    self.push_error("load() import must be string or alias=\"symbol\"")
    return None
  }
  self.skip_value_space()
  match self.parse_string() {
    Some(Str(symbol_name)) => Some((alias_name, symbol_name))
    Some(_) => None
    None => None
  }
}

///|
fn StarlarkParser::parse_load_call(
  self : StarlarkParser,
  name : String,
  start_line : Int,
  start_col : Int,
) -> StarlarkCall {
  let args : Array[StarlarkArg] = []
  let imports : Map[String, StarlarkValue] = {}
  self.skip_value_space()
  if self.consume_char(')') {
    self.push_error("load() requires path argument")
    return { name, args, line: start_line, column: start_col }
  }

  if not(self.parse_load_path_arg(args)) {
    self.recover_to_arg_boundary()
  }

  while true {
    self.skip_value_space()
    if self.consume_char(')') {
      break
    }
    if self.peek() is None {
      self.push_error("expected ')' to close load()")
      break
    }
    if not(self.consume_char(',')) {
      self.push_error("expected ',' or ')' after load() argument")
      self.recover_to_arg_boundary()
      if self.consume_char(')') {
        break
      }
      if self.consume_char(',') {
        continue
      }
      break
    }

    self.skip_value_space()
    if self.consume_char(')') {
      break
    }
    if self.peek() is None {
      self.push_error("expected ')' to close load()")
      break
    }
    match self.parse_load_import_arg() {
      Some((local_name, symbol_name)) =>
        if imports.get(local_name) is Some(_) {
          self.push_error("duplicate load() import '\{local_name}'")
        } else {
          imports[local_name] = Str(symbol_name)
        }
      None => {
        self.recover_to_arg_boundary()
        if self.consume_char(')') {
          break
        }
      }
    }
  }
  if imports.length() > 0 {
    args.push({
      name: "imports",
      value: Dict(imports),
      line: start_line,
      column: start_col,
    })
  }

  { name, args, line: start_line, column: start_col }
}

///|
fn StarlarkParser::parse_call_with_name(
  self : StarlarkParser,
  name : String,
  start_line : Int,
  start_col : Int,
) -> StarlarkCall? {
  guard self.consume_char('(') else {
    self.push_error("expected '(' after statement name")
    return None
  }
  if name == "load" {
    return Some(self.parse_load_call(name, start_line, start_col))
  }
  let args : Array[StarlarkArg] = []
  let mut positional_index = 0
  let mut seen_keyword = false
  self.skip_value_space()
  if self.consume_char(')') {
    return Some({ name, args, line: start_line, column: start_col })
  }
  while true {
    self.skip_value_space()
    if self.peek() is None {
      self.push_error("expected ')' to close argument list")
      break
    }
    if self.peek() is Some('*') {
      self.push_error("splat arguments are not supported")
      self.recover_to_arg_boundary()
      if self.consume_char(')') {
        break
      }
      if self.consume_char(',') {
        continue
      }
      break
    }
    let arg_line = self.line
    let arg_col = self.column
    let saved_idx = self.idx
    let saved_line = self.line
    let saved_col = self.column
    let mut parsed_keyword = false
    if self.parse_identifier() is Some(arg_name) {
      self.skip_value_space()
      if self.consume_char('=') {
        parsed_keyword = true
        seen_keyword = true
        match self.parse_value() {
          Some(value) =>
            args.push({ name: arg_name, value, line: arg_line, column: arg_col })
          None => {
            self.recover_to_arg_boundary()
            if self.consume_char(')') {
              break
            }
            if self.consume_char(',') {
              continue
            }
            break
          }
        }
      } else {
        self.idx = saved_idx
        self.line = saved_line
        self.column = saved_col
      }
    } else {
      self.idx = saved_idx
      self.line = saved_line
      self.column = saved_col
    }
    if not(parsed_keyword) {
      if seen_keyword {
        self.push_error("positional argument cannot follow keyword argument")
        self.recover_to_arg_boundary()
        if self.consume_char(')') {
          break
        }
        if self.consume_char(',') {
          continue
        }
        break
      }
      match self.parse_value() {
        Some(value) => {
          let pos_name = "$pos\{positional_index}"
          positional_index += 1
          args.push({ name: pos_name, value, line: arg_line, column: arg_col })
        }
        None => {
          self.recover_to_arg_boundary()
          if self.consume_char(')') {
            break
          }
          if self.consume_char(',') {
            continue
          }
          break
        }
      }
    }
    self.skip_value_space()
    if self.peek() is Some('=') {
      self.push_error("keyword argument must have form name=expr")
      self.recover_to_arg_boundary()
      if self.consume_char(')') {
        break
      }
      if self.consume_char(',') {
        continue
      }
      break
    }
    if self.consume_char(',') {
      self.skip_value_space()
      if self.consume_char(')') {
        break
      }
      continue
    }
    if self.consume_char(')') {
      break
    }
    self.push_error("expected ',' or ')' after argument")
    self.recover_to_arg_boundary()
    if self.consume_char(')') {
      break
    }
    if self.consume_char(',') {
      continue
    }
    break
  }
  Some({ name, args, line: start_line, column: start_col })
}

///|
fn StarlarkParser::parse_assignment_with_name(
  self : StarlarkParser,
  name : String,
  start_line : Int,
  start_col : Int,
) -> StarlarkCall {
  let args : Array[StarlarkArg] = [
    { name: "name", value: Str(name), line: start_line, column: start_col },
  ]
  self.skip_value_space()
  let value_line = self.line
  let value_col = self.column
  match self.parse_value() {
    Some(value) =>
      args.push({ name: "value", value, line: value_line, column: value_col })
    None => ()
  }
  { name: "__assign__", args, line: start_line, column: start_col }
}

///|
fn line_has_non_space(text : String) -> Bool {
  let mut i = 0
  while i < text.length() {
    if not(is_inline_space(text.unsafe_get(i))) {
      return true
    }
    i += 1
  }
  false
}

///|
fn line_is_empty_or_comment(text : String) -> Bool {
  let mut i = 0
  while i < text.length() {
    let ch = text.unsafe_get(i)
    if is_inline_space(ch) {
      i += 1
      continue
    }
    return ch == '#'
  }
  true
}

///|
fn StarlarkParser::parse_inline_suite_source(
  self : StarlarkParser,
  owner : String,
) -> String? {
  self.skip_inline_space()
  let start = self.idx
  while self.peek() is Some(ch) {
    if ch == '\n' {
      break
    }
    self.advance() |> ignore
  }
  let body = String::unsafe_substring(self.text, start~, end=self.idx)
  if line_has_non_space(body) {
    Some(body)
  } else {
    self.push_error("expected statement body after \{owner}")
    None
  }
}

///|
fn StarlarkParser::parse_block_suite_source(
  self : StarlarkParser,
  owner : String,
  base_indent : Int,
) -> String? {
  let lines : Array[String] = []
  let mut suite_indent = -1

  while true {
    if self.peek() is None {
      break
    }
    let line_start_idx = self.idx
    let line_start_line = self.line
    let line_start_col = self.column
    let mut indent = 0
    while self.peek() is Some(ch) {
      if is_inline_space(ch) {
        self.advance() |> ignore
        indent += 1
      } else {
        break
      }
    }

    let mut line_end = self.idx
    while self.peek() is Some(ch) {
      if ch == '\n' {
        break
      }
      self.advance() |> ignore
      line_end = self.idx
    }
    let raw_line = String::unsafe_substring(
      self.text,
      start=line_start_idx,
      end=line_end,
    )
    if line_is_empty_or_comment(raw_line) {
      if self.peek() is Some('\n') {
        self.advance() |> ignore
      }
      continue
    }

    if indent <= base_indent {
      self.idx = line_start_idx
      self.line = line_start_line
      self.column = line_start_col
      break
    }
    if suite_indent < 0 {
      suite_indent = indent
    } else if indent < suite_indent {
      self.idx = line_start_idx
      self.line = line_start_line
      self.column = line_start_col
      break
    }

    let body_start = line_start_idx + suite_indent
    lines.push(
      String::unsafe_substring(self.text, start=body_start, end=line_end),
    )
    if self.peek() is Some('\n') {
      self.advance() |> ignore
      continue
    }
    break
  }

  if lines.length() == 0 {
    self.push_error("expected indented statement body after \{owner}")
    None
  } else {
    Some(lines.join("\n"))
  }
}

///|
fn StarlarkParser::parse_suite_source(
  self : StarlarkParser,
  owner : String,
  start_col : Int,
) -> (String?, Bool) {
  self.skip_inline_space()
  if self.peek() is Some('#') {
    self.skip_comment()
  }
  if self.peek() is Some('\n') {
    self.advance() |> ignore
    return (self.parse_block_suite_source(owner, start_col - 1), true)
  }
  (self.parse_inline_suite_source(owner), false)
}

///|
fn source_with_elif_head_as_if(source : String) -> String {
  let mut idx = 0
  while idx < source.length() {
    let ch = source.unsafe_get(idx)
    if is_inline_space(ch) {
      idx += 1
      continue
    }
    break
  }
  if idx + 4 > source.length() {
    return source
  }
  let head = String::unsafe_substring(source, start=idx, end=idx + 4)
  if head != "elif" {
    return source
  }
  let prefix = String::unsafe_substring(source, start=0, end=idx)
  let suffix = String::unsafe_substring(
    source,
    start=idx + 4,
    end=source.length(),
  )
  prefix + "if" + suffix
}

///|
fn StarlarkParser::parse_if_else_source(
  self : StarlarkParser,
  start_col : Int,
) -> (String, Bool)? {
  let saved_idx = self.idx
  let saved_line = self.line
  let saved_col = self.column

  let line_start_idx = self.idx
  let mut indent = 0
  while self.peek() is Some(ch) {
    if is_inline_space(ch) {
      self.advance() |> ignore
      indent += 1
    } else {
      break
    }
  }

  if indent != start_col - 1 {
    self.idx = saved_idx
    self.line = saved_line
    self.column = saved_col
    return None
  }

  let keyword_start_line = self.line
  let keyword_start_col = self.column
  guard self.parse_identifier() is Some(keyword) else {
    self.idx = saved_idx
    self.line = saved_line
    self.column = saved_col
    return None
  }

  if keyword == "else" {
    self.skip_inline_space()
    if not(self.consume_char(':')) {
      self.push_error("expected ':' after else")
    }
    let (suite, consumed_newline) = self.parse_suite_source(
      "else", keyword_start_col,
    )
    match suite {
      Some(source) => Some((source, consumed_newline))
      None => None
    }
  } else if keyword == "elif" {
    let _ = self.parse_if_statement(keyword_start_line, keyword_start_col)
    let raw = String::unsafe_substring(
      self.text,
      start=line_start_idx,
      end=self.idx,
    )
    Some((source_with_elif_head_as_if(raw), true))
  } else {
    self.idx = saved_idx
    self.line = saved_line
    self.column = saved_col
    None
  }
}

///|
fn StarlarkParser::parse_if_statement(
  self : StarlarkParser,
  start_line : Int,
  start_col : Int,
) -> StarlarkCall {
  let args : Array[StarlarkArg] = []
  self.skip_value_space()
  let cond_line = self.line
  let cond_col = self.column
  match self.parse_value() {
    Some(value) =>
      args.push({ name: "cond", value, line: cond_line, column: cond_col })
    None => ()
  }
  self.skip_inline_space()
  if not(self.consume_char(':')) {
    self.push_error("expected ':' after if condition")
  }
  let mut needs_skip_statement_end = false
  let (suite, consumed_newline) = self.parse_suite_source("if", start_col)
  if consumed_newline {
    needs_skip_statement_end = true
  }
  match suite {
    Some(body) =>
      args.push({
        name: "then",
        value: Str(body),
        line: start_line,
        column: start_col,
      })
    None => ()
  }
  if consumed_newline {
    match self.parse_if_else_source(start_col) {
      Some((source, consumed_else_newline)) => {
        args.push({
          name: "else",
          value: Str(source),
          line: start_line,
          column: start_col,
        })
        if consumed_else_newline {
          needs_skip_statement_end = true
        }
      }
      None => ()
    }
  }
  if needs_skip_statement_end {
    self.skip_statement_end_once = true
  }
  { name: "__if__", args, line: start_line, column: start_col }
}

///|
fn StarlarkParser::parse_for_statement(
  self : StarlarkParser,
  start_line : Int,
  start_col : Int,
) -> StarlarkCall {
  let args : Array[StarlarkArg] = []
  self.skip_value_space()
  let name_line = self.line
  let name_col = self.column
  match self.parse_identifier() {
    Some(loop_name) =>
      args.push({
        name: "name",
        value: Str(loop_name),
        line: name_line,
        column: name_col,
      })
    None => self.push_error("expected loop variable after for")
  }

  self.skip_value_space()
  if not(self.consume_keyword("in")) {
    self.push_error("expected 'in' after for loop variable")
  }

  self.skip_value_space()
  let iter_line = self.line
  let iter_col = self.column
  match self.parse_value() {
    Some(value) =>
      args.push({ name: "iter", value, line: iter_line, column: iter_col })
    None => ()
  }

  self.skip_inline_space()
  if not(self.consume_char(':')) {
    self.push_error("expected ':' after for iterable")
  }
  let (suite, consumed_newline) = self.parse_suite_source("for", start_col)
  if consumed_newline {
    self.skip_statement_end_once = true
  }
  match suite {
    Some(body) =>
      args.push({
        name: "body",
        value: Str(body),
        line: start_line,
        column: start_col,
      })
    None => ()
  }
  { name: "__for__", args, line: start_line, column: start_col }
}

///|
fn StarlarkParser::parse_while_statement(
  self : StarlarkParser,
  start_line : Int,
  start_col : Int,
) -> StarlarkCall {
  let args : Array[StarlarkArg] = []
  self.skip_value_space()
  let cond_line = self.line
  let cond_col = self.column
  match self.parse_value() {
    Some(value) =>
      args.push({ name: "cond", value, line: cond_line, column: cond_col })
    None => ()
  }
  self.skip_inline_space()
  if not(self.consume_char(':')) {
    self.push_error("expected ':' after while condition")
  }
  let (suite, consumed_newline) = self.parse_suite_source("while", start_col)
  if consumed_newline {
    self.skip_statement_end_once = true
  }
  match suite {
    Some(body) =>
      args.push({
        name: "body",
        value: Str(body),
        line: start_line,
        column: start_col,
      })
    None => ()
  }
  { name: "__while__", args, line: start_line, column: start_col }
}

///|
fn StarlarkParser::parse_def_statement(
  self : StarlarkParser,
  start_line : Int,
  start_col : Int,
) -> StarlarkCall {
  let args : Array[StarlarkArg] = []
  self.skip_value_space()
  let name_line = self.line
  let name_col = self.column
  let mut fn_name = ""
  match self.parse_identifier() {
    Some(value) => fn_name = value
    None => self.push_error("expected function name after def")
  }
  if fn_name.length() > 0 {
    args.push({
      name: "name",
      value: Str(fn_name),
      line: name_line,
      column: name_col,
    })
  }
  self.skip_inline_space()
  if not(self.consume_char('(')) {
    self.push_error("expected '(' after function name")
  }
  let params : Array[StarlarkValue] = []
  let defaults : Map[String, StarlarkValue] = {}
  let mut seen_default = false
  self.skip_value_space()
  if not(self.consume_char(')')) {
    while true {
      self.skip_value_space()
      match self.parse_identifier() {
        Some(param_name) => {
          self.skip_value_space()
          if self.consume_char('=') {
            seen_default = true
            self.skip_value_space()
            match self.parse_value() {
              Some(default_value) => defaults[param_name] = default_value
              None => ()
            }
          } else if seen_default {
            self.push_error("non-default parameter follows default parameter")
          }
          params.push(Str(param_name))
        }
        None => {
          self.push_error("expected parameter name in def signature")
          self.recover_to_arg_boundary()
          if self.consume_char(')') {
            break
          }
          if self.consume_char(',') {
            continue
          }
          break
        }
      }
      self.skip_value_space()
      if self.consume_char(',') {
        self.skip_value_space()
        if self.consume_char(')') {
          break
        }
        continue
      }
      if self.consume_char(')') {
        break
      }
      self.push_error("expected ',' or ')' after def parameter")
      self.recover_to_arg_boundary()
      if self.consume_char(')') {
        break
      }
      if self.consume_char(',') {
        continue
      }
      break
    }
  }
  args.push({
    name: "params",
    value: List(params),
    line: start_line,
    column: start_col,
  })
  if defaults.length() > 0 {
    args.push({
      name: "defaults",
      value: Dict(defaults),
      line: start_line,
      column: start_col,
    })
  }
  self.skip_inline_space()
  if not(self.consume_char(':')) {
    self.push_error("expected ':' after def signature")
  }
  let (suite, consumed_newline) = self.parse_suite_source("def", start_col)
  if consumed_newline {
    self.skip_statement_end_once = true
  }
  match suite {
    Some(body) =>
      args.push({
        name: "body",
        value: Str(body),
        line: start_line,
        column: start_col,
      })
    None => ()
  }
  { name: "__def__", args, line: start_line, column: start_col }
}

///|
fn StarlarkParser::parse_return_statement(
  self : StarlarkParser,
  start_line : Int,
  start_col : Int,
) -> StarlarkCall {
  let args : Array[StarlarkArg] = []
  self.skip_inline_space()
  let has_value = match self.peek() {
    Some('\n') => false
    Some(';') => false
    Some('#') => false
    Some(_) => true
    None => false
  }
  if has_value {
    let value_line = self.line
    let value_col = self.column
    match self.parse_value() {
      Some(value) =>
        args.push({ name: "value", value, line: value_line, column: value_col })
      None => ()
    }
  }
  { name: "__return__", args, line: start_line, column: start_col }
}

///|
fn parse_control_statement(
  name : String,
  start_line : Int,
  start_col : Int,
) -> StarlarkCall {
  { name, args: [], line: start_line, column: start_col }
}

///|
fn StarlarkParser::parse_statement(self : StarlarkParser) -> StarlarkCall? {
  let start_line = self.line
  let start_col = self.column
  guard self.parse_identifier() is Some(name) else {
    self.push_error("expected statement name")
    return None
  }
  if name == "if" {
    return Some(self.parse_if_statement(start_line, start_col))
  }
  if name == "for" {
    return Some(self.parse_for_statement(start_line, start_col))
  }
  if name == "while" {
    return Some(self.parse_while_statement(start_line, start_col))
  }
  if name == "def" {
    return Some(self.parse_def_statement(start_line, start_col))
  }
  if name == "return" {
    return Some(self.parse_return_statement(start_line, start_col))
  }
  if name == "break" {
    return Some(parse_control_statement("__break__", start_line, start_col))
  }
  if name == "continue" {
    return Some(parse_control_statement("__continue__", start_line, start_col))
  }
  self.skip_inline_space()
  if self.consume_char('=') {
    return Some(self.parse_assignment_with_name(name, start_line, start_col))
  }
  self.parse_call_with_name(name, start_line, start_col)
}

///|
fn StarlarkParser::recover_to_statement_boundary(self : StarlarkParser) -> Unit {
  while self.peek() is Some(ch) {
    if ch == '\n' || ch == ';' {
      break
    }
    self.advance() |> ignore
  }
  if self.peek() is Some('\n') || self.peek() is Some(';') {
    self.advance() |> ignore
  }
}

///|
fn StarlarkParser::consume_statement_end(self : StarlarkParser) -> Unit {
  if self.skip_statement_end_once {
    self.skip_statement_end_once = false
    self.skip_statement_separators()
    return
  }
  self.skip_inline_space()
  if self.peek() is None {
    return
  }
  if self.peek() is Some('#') {
    self.skip_comment()
    if self.peek() is Some('\n') {
      self.advance() |> ignore
    }
    self.skip_statement_separators()
    return
  }
  if self.consume_char(';') || self.consume_char('\n') {
    self.skip_statement_separators()
    return
  }
  self.push_error("expected newline or ';' after statement")
  self.recover_to_statement_boundary()
  self.skip_statement_separators()
}

///|
fn parse_syntax(text : String) -> StarlarkSyntaxResult {
  let parser = parser_new(text)
  let calls : Array[StarlarkCall] = []
  parser.skip_statement_separators()
  while parser.peek() is Some(_) {
    match parser.parse_statement() {
      Some(call) => calls.push(call)
      None => parser.recover_to_statement_boundary()
    }
    parser.consume_statement_end()
  }
  { calls, errors: parser.errors }
}
