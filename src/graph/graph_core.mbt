///|
fn file_matches_node(file : String, node : @types.GraphNodeInput) -> Bool {
  file == node.path || file.has_prefix(node.path + "/")
}

///|
fn build_reverse_deps_map(
  graph : @types.DependencyGraphInput,
) -> Map[String, Array[String]] {
  let reverse : Map[String, Array[String]] = {}
  for node in graph.nodes {
    for dep in node.dependencies {
      let dependents = reverse.get_or_init(dep, fn() { [] })
      dependents.push(node.id)
    }
  }
  reverse
}

///|
fn find_node(
  graph : @types.DependencyGraphInput,
  node_id : String,
) -> @types.GraphNodeInput? {
  for node in graph.nodes {
    if node.id == node_id {
      return Some(node)
    }
  }
  None
}

///|
pub fn build_reverse_deps(
  graph : @types.DependencyGraphInput,
) -> Array[@types.ReverseDepEntry] {
  let entries : Array[@types.ReverseDepEntry] = []
  let reverse = build_reverse_deps_map(graph)
  reverse.each(fn(id, dependents) {
    entries.push(@types.ReverseDepEntry::{ id, dependents })
  })
  entries
}

///|
fn expand_queue(
  queue : Array[String],
  index : Int,
  reverse : Map[String, Array[String]],
  affected : Map[String, Bool],
) -> Unit {
  if index >= queue.length() {
    return
  }
  let current = queue[index]
  let dependents = reverse.get_or_init(current, fn() { [] })
  for dependent in dependents {
    if !affected.contains(dependent) {
      affected.set(dependent, true)
      queue.push(dependent)
    }
  }
  expand_queue(queue, index + 1, reverse, affected)
}

///|
pub fn expand_transitive(
  graph : @types.DependencyGraphInput,
  initial : Array[String],
) -> Array[String] {
  let affected : Map[String, Bool] = {}
  let queue : Array[String] = []
  for node_id in initial {
    if !affected.contains(node_id) {
      affected.set(node_id, true)
      queue.push(node_id)
    }
  }
  let reverse = build_reverse_deps_map(graph)
  expand_queue(queue, 0, reverse, affected)
  queue
}

///|
pub fn find_affected_nodes(
  graph : @types.DependencyGraphInput,
  changed_files : Array[String],
) -> Array[String] {
  let directly_affected : Map[String, Bool] = {}
  for file in changed_files {
    for node in graph.nodes {
      if file_matches_node(file, node) {
        directly_affected.set(node.id, true)
      }
    }
  }
  let initial : Array[String] = []
  for node in graph.nodes {
    if directly_affected.contains(node.id) {
      initial.push(node.id)
    }
  }
  expand_transitive(graph, initial)
}

///|
fn visit_topological(
  graph : @types.DependencyGraphInput,
  node_id : String,
  visited : Map[String, Bool],
  result : Array[String],
) -> Unit {
  if visited.contains(node_id) {
    return
  }
  visited.set(node_id, true)
  match find_node(graph, node_id) {
    Some(node) =>
      for dep in node.dependencies {
        visit_topological(graph, dep, visited, result)
      }
    None => ()
  }
  result.push(node_id)
}

///|
pub fn topological_sort(graph : @types.DependencyGraphInput) -> Array[String] {
  let visited : Map[String, Bool] = {}
  let result : Array[String] = []
  for node in graph.nodes {
    visit_topological(graph, node.id, visited, result)
  }
  result
}

///|
pub fn get_affected_test_patterns(
  graph : @types.DependencyGraphInput,
  affected_ids : Array[String],
) -> Array[String] {
  let patterns : Array[String] = []
  for node_id in affected_ids {
    match find_node(graph, node_id) {
      Some(node) =>
        for pattern in node.test_patterns {
          patterns.push(pattern)
        }
      None => ()
    }
  }
  patterns
}
