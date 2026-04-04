///| Parsed flaker.toml configuration.
pub struct FlakerConfig {
  owner : String
  name : String
  storage_path : String
  adapter_type : String
  artifact_name : String
} derive(Show)

///| Parse flaker.toml content into FlakerConfig.
pub fn parse_config(content : String) -> FlakerConfig raise {
  let toml = @toml.parse(content)
  guard toml is TomlTable(root) else {
    raise Failure("flaker.toml: expected table at root")
  }

  // [repo]
  let owner = get_string(root, "repo", "owner")
  let name = get_string(root, "repo", "name")

  // [storage]
  let storage_path = get_string_or(root, "storage", "path", ".flaker/data")

  // [adapter]
  let adapter_type = get_string_or(root, "adapter", "type", "playwright")
  let artifact_name = get_string_or(root, "adapter", "artifact_name", "playwright-report")

  { owner, name, storage_path, adapter_type, artifact_name }
}

///|
fn get_table(
  root : Map[String, @toml.TomlValue],
  section : String,
) -> Map[String, @toml.TomlValue] raise {
  guard root.get(section) is Some(TomlTable(t)) else {
    raise Failure("flaker.toml: missing [\{section}]")
  }
  t
}

///|
fn get_string(
  root : Map[String, @toml.TomlValue],
  section : String,
  key : String,
) -> String raise {
  let tbl = get_table(root, section)
  guard tbl.get(key) is Some(TomlString(s)) else {
    raise Failure("flaker.toml: missing \{section}.\{key}")
  }
  s
}

///|
fn get_string_or(
  root : Map[String, @toml.TomlValue],
  section : String,
  key : String,
  default : String,
) -> String {
  try {
    get_string(root, section, key)
  } catch {
    _ => default
  }
}
