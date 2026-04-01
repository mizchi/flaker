///|
priv struct StarlarkBuiltinArgSpec {
  name : String
  required : Bool
}

///|
priv struct StarlarkBuiltinSpec {
  canonical_name : String
  names : Array[String]
  args : Array[StarlarkBuiltinArgSpec]
}

///|
fn builtin_arg(
  name : String,
  required? : Bool = false,
) -> StarlarkBuiltinArgSpec {
  { name, required }
}

///|
fn builtin_specs() -> Array[StarlarkBuiltinSpec] {
  [
    {
      canonical_name: "workflow",
      names: ["workflow"],
      args: [builtin_arg("name"), builtin_arg("max_parallel")],
    },
    {
      canonical_name: "node",
      names: ["node"],
      args: [
        builtin_arg("id", required=true),
        builtin_arg("depends_on"),
        builtin_arg("required"),
      ],
    },
    {
      canonical_name: "task",
      names: ["task", "target"],
      args: [
        builtin_arg("id", required=true),
        builtin_arg("node", required=true),
        builtin_arg("cmd", required=true),
        builtin_arg("needs"),
        builtin_arg("required"),
        builtin_arg("srcs"),
        builtin_arg("outs"),
        builtin_arg("env"),
        builtin_arg("cwd"),
        builtin_arg("trigger"),
      ],
    },
    {
      canonical_name: "entrypoint",
      names: ["entrypoint"],
      args: [builtin_arg("targets", required=true)],
    },
    {
      canonical_name: "var",
      names: ["var"],
      args: [
        builtin_arg("name", required=true),
        builtin_arg("type"),
        builtin_arg("required"),
        builtin_arg("default"),
      ],
    },
    {
      canonical_name: "config",
      names: ["config"],
      args: [
        builtin_arg("name", required=true),
        builtin_arg("value", required=true),
      ],
    },
    {
      canonical_name: "load",
      names: ["load"],
      args: [builtin_arg("path", required=true), builtin_arg("imports")],
    },
    {
      canonical_name: "__assign__",
      names: ["__assign__"],
      args: [
        builtin_arg("name", required=true),
        builtin_arg("value", required=true),
      ],
    },
    {
      canonical_name: "__if__",
      names: ["__if__"],
      args: [
        builtin_arg("cond", required=true),
        builtin_arg("then", required=true),
        builtin_arg("else"),
      ],
    },
    {
      canonical_name: "__for__",
      names: ["__for__"],
      args: [
        builtin_arg("name", required=true),
        builtin_arg("iter", required=true),
        builtin_arg("body", required=true),
      ],
    },
    {
      canonical_name: "__while__",
      names: ["__while__"],
      args: [
        builtin_arg("cond", required=true),
        builtin_arg("body", required=true),
      ],
    },
    {
      canonical_name: "__def__",
      names: ["__def__"],
      args: [
        builtin_arg("name", required=true),
        builtin_arg("params", required=true),
        builtin_arg("defaults"),
        builtin_arg("body", required=true),
      ],
    },
    {
      canonical_name: "__return__",
      names: ["__return__"],
      args: [builtin_arg("value")],
    },
    { canonical_name: "__break__", names: ["__break__"], args: [] },
    { canonical_name: "__continue__", names: ["__continue__"], args: [] },
  ]
}

///|
fn builtin_spec_for(name : String) -> StarlarkBuiltinSpec? {
  for spec in builtin_specs() {
    if spec.names.contains(name) {
      return Some(spec)
    }
  }
  None
}

///|
fn builtin_canonical_name(name : String) -> String {
  match builtin_spec_for(name) {
    Some(spec) => spec.canonical_name
    None => name
  }
}

///|
fn builtin_allowed_args(name : String) -> Array[String] {
  match builtin_spec_for(name) {
    Some(spec) => {
      let args : Array[String] = []
      for arg in spec.args {
        args.push(arg.name)
      }
      args
    }
    None => []
  }
}

///|
fn builtin_required_args(name : String) -> Array[String] {
  match builtin_spec_for(name) {
    Some(spec) => {
      let args : Array[String] = []
      for arg in spec.args {
        if arg.required {
          args.push(arg.name)
        }
      }
      args
    }
    None => []
  }
}
