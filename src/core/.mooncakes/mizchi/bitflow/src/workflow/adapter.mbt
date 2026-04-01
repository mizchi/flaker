///|
pub struct CommandResult {
  code : Int
  stdout : String
  stderr : String
}

///|
pub fn CommandResult::ok(self : CommandResult) -> Bool {
  self.code == 0
}

///|
pub fn command_success(
  stdout? : String = "",
  stderr? : String = "",
) -> CommandResult {
  { code: 0, stdout, stderr }
}

///|
pub fn command_failure(
  code? : Int = 1,
  stdout? : String = "",
  stderr? : String = "command failed",
) -> CommandResult {
  let actual_code = if code == 0 { 1 } else { code }
  { code: actual_code, stdout, stderr }
}

///|
pub struct CommandAdapter {
  run : (String, String?, Map[String, String]) -> CommandResult
}

///|
pub fn CommandAdapter::new(
  run : (String, String?, Map[String, String]) -> CommandResult,
) -> CommandAdapter {
  { run, }
}

///|
pub fn CommandAdapter::none() -> CommandAdapter {
  {
    run: fn(_cmd : String, _cwd : String?, _env : Map[String, String]) {
      command_failure(stderr="command adapter is not configured")
    },
  }
}

///|
pub struct FsAdapter {
  read_text : (String) -> String?
  write_text : (String, String) -> Bool
  exists : (String) -> Bool
  list_paths : () -> Array[String]
}

///|
pub fn FsAdapter::new(
  read_text : (String) -> String?,
  write_text : (String, String) -> Bool,
  exists : (String) -> Bool,
  list_paths : () -> Array[String],
) -> FsAdapter {
  { read_text, write_text, exists, list_paths }
}

///|
pub fn FsAdapter::none() -> FsAdapter {
  {
    read_text: fn(_path : String) { None },
    write_text: fn(_path : String, _content : String) { false },
    exists: fn(_path : String) { false },
    list_paths: fn() { [] },
  }
}

///|
pub fn FsAdapter::memory_with(initial : Map[String, String]) -> FsAdapter {
  let store : Map[String, String] = {}
  for path, content in initial {
    store[path] = content
  }
  {
    read_text: fn(path : String) { store.get(path) },
    write_text: fn(path : String, content : String) {
      store[path] = content
      true
    },
    exists: fn(path : String) { store.get(path) is Some(_) },
    list_paths: fn() {
      let paths : Array[String] = []
      for path, _ in store {
        paths.push(path)
      }
      paths
    },
  }
}

///|
pub fn FsAdapter::memory() -> FsAdapter {
  FsAdapter::memory_with({})
}

///|
pub struct WorkflowAdapter {
  fs : FsAdapter
  cmd : CommandAdapter
}

///|
pub fn WorkflowAdapter::new(
  fs : FsAdapter,
  cmd : CommandAdapter,
) -> WorkflowAdapter {
  { fs, cmd }
}

///|
pub fn WorkflowAdapter::none() -> WorkflowAdapter {
  { fs: FsAdapter::none(), cmd: CommandAdapter::none() }
}
