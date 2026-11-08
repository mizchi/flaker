///|
/// Execute a shell command and return its exit code.
fn shell_exec(cmd : String) -> Int32 {
  shell_system(cmd)
}

///|
/// Execute a shell command and return its stdout lines.
fn shell_lines(cmd : String) -> Array[String] {
  let output = shell_capture(cmd)
  let lines : Array[String] = []
  for line in output.split("\n") {
    let s = line.to_owned()
    if s.length() > 0 {
      lines.push(s)
    }
  }
  lines
}

///|
/// FFI: run command via system(), return exit code.
extern "C" fn c_system(cmd : Bytes) -> Int32 = "flaker_system"

///|
/// FFI: run command via popen(), return stdout as string.
extern "C" fn c_popen_read(cmd : Bytes, buf : Bytes, buf_len : Int32) -> Int32 = "flaker_popen_read"

///|
fn shell_system(cmd : String) -> Int32 {
  let cmd_bytes = string_to_cstr(cmd)
  c_system(cmd_bytes)
}

///|
fn shell_capture(cmd : String) -> String {
  let cmd_bytes = string_to_cstr(cmd)
  let buf_len = 65536
  let buf = Bytes::make(buf_len, 0)
  let n = c_popen_read(cmd_bytes, buf, buf_len)
  if n <= 0 {
    return ""
  }
  let result = Bytes::makei(n, fn(i) { buf[i] })
  bytes_to_string(result)
}

///|
/// Convert MoonBit String to null-terminated C string bytes.
fn string_to_cstr(s : String) -> Bytes {
  let len = s.length()
  Bytes::makei(len + 1, fn(i) {
    if i < len {
      s[i].to_int().to_byte()
    } else {
      b'\x00'
    }
  })
}
