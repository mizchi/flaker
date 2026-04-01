///|
/// Core workflow graph node for bitflow execution planning.
pub struct FlowNode {
  id : String
  required : Bool
  depends_on : Array[String]
}

///|
pub fn new_node(
  id : String,
  depends_on : Array[String],
  required? : Bool = true,
) -> FlowNode {
  { id, required, depends_on }
}

///|
fn node_id_set(nodes : Array[FlowNode]) -> Map[String, Bool] {
  let ids : Map[String, Bool] = {}
  for node in nodes {
    ids[node.id] = true
  }
  ids
}

///|
fn node_map(nodes : Array[FlowNode]) -> Map[String, FlowNode] {
  let result : Map[String, FlowNode] = {}
  for node in nodes {
    result[node.id] = node
  }
  result
}

///|
pub fn topological_nodes(nodes : Array[FlowNode]) -> Array[FlowNode] {
  let ids = node_id_set(nodes)
  let mapped = node_map(nodes)
  let indegree : Map[String, Int] = {}
  let dependents : Map[String, Array[String]] = {}
  for node in nodes {
    indegree[node.id] = 0
    dependents[node.id] = []
  }
  for node in nodes {
    let mut deg = indegree.get(node.id).unwrap_or(0)
    for dep in node.depends_on {
      if ids.get(dep) is Some(_) {
        deg += 1
        let next = dependents.get(dep).unwrap_or([])
        next.push(node.id)
        dependents[dep] = next
      }
    }
    indegree[node.id] = deg
  }
  let queue : Array[String] = []
  for node in nodes {
    if indegree.get(node.id).unwrap_or(0) == 0 {
      queue.push(node.id)
    }
  }
  let order_ids : Array[String] = []
  let visited : Map[String, Bool] = {}
  while queue.length() > 0 {
    let current = queue.pop().unwrap_or("")
    if current.length() == 0 || visited.get(current) is Some(_) {
      continue
    }
    visited[current] = true
    order_ids.push(current)
    let followers = dependents.get(current).unwrap_or([])
    for follower in followers {
      let next_deg = indegree.get(follower).unwrap_or(0) - 1
      indegree[follower] = next_deg
      if next_deg == 0 {
        queue.push(follower)
      }
    }
  }
  let ordered : Array[FlowNode] = []
  for id in order_ids {
    if mapped.get(id) is Some(node) {
      ordered.push(node)
    }
  }
  for node in nodes {
    if visited.get(node.id) is None {
      ordered.push(node)
    }
  }
  ordered
}

///|
pub fn has_dependency_cycle(nodes : Array[FlowNode]) -> Bool {
  let ids = node_id_set(nodes)
  let indegree : Map[String, Int] = {}
  let dependents : Map[String, Array[String]] = {}
  for node in nodes {
    indegree[node.id] = 0
    dependents[node.id] = []
  }
  for node in nodes {
    let mut deg = indegree.get(node.id).unwrap_or(0)
    for dep in node.depends_on {
      if ids.get(dep) is Some(_) {
        deg += 1
        let next = dependents.get(dep).unwrap_or([])
        next.push(node.id)
        dependents[dep] = next
      }
    }
    indegree[node.id] = deg
  }
  let queue : Array[String] = []
  for node in nodes {
    if indegree.get(node.id).unwrap_or(0) == 0 {
      queue.push(node.id)
    }
  }
  let mut visited_count = 0
  while queue.length() > 0 {
    let current = queue.pop().unwrap_or("")
    if current.length() == 0 {
      continue
    }
    visited_count += 1
    let followers = dependents.get(current).unwrap_or([])
    for follower in followers {
      let next_deg = indegree.get(follower).unwrap_or(0) - 1
      indegree[follower] = next_deg
      if next_deg == 0 {
        queue.push(follower)
      }
    }
  }
  visited_count < nodes.length()
}

///|
pub fn graph_issues(nodes : Array[FlowNode]) -> Array[String] {
  let issues : Array[String] = []
  let seen_ids : Map[String, Bool] = {}
  for node in nodes {
    if node.id.length() == 0 {
      issues.push("node id is empty")
    } else if seen_ids.get(node.id) is Some(_) {
      issues.push("duplicate node id '\{node.id}'")
    } else {
      seen_ids[node.id] = true
    }
  }
  let ids = node_id_set(nodes)
  for node in nodes {
    for dep in node.depends_on {
      if ids.get(dep) is None {
        issues.push("node '\{node.id}' depends on unknown node '\{dep}'")
      }
    }
  }
  if has_dependency_cycle(nodes) {
    issues.push("dependency graph has a cycle")
  }
  issues
}

///|
pub fn expand_affected_nodes(
  nodes : Array[FlowNode],
  initial : Map[String, Bool],
) -> Map[String, Bool] {
  let known_ids = node_id_set(nodes)
  let neighbors : Map[String, Array[String]] = {}
  for node in nodes {
    neighbors[node.id] = []
  }
  for node in nodes {
    let seen_neighbor : Map[String, Bool] = {}
    let next = neighbors.get(node.id).unwrap_or([])
    for dep in node.depends_on {
      if known_ids.get(dep) is Some(_) && seen_neighbor.get(dep) is None {
        next.push(dep)
        seen_neighbor[dep] = true
      }
    }
    neighbors[node.id] = next
    for dep in node.depends_on {
      if known_ids.get(dep) is Some(_) {
        let dep_next = neighbors.get(dep).unwrap_or([])
        if dep_next.contains(node.id) {
          continue
        }
        dep_next.push(node.id)
        neighbors[dep] = dep_next
      }
    }
  }
  let affected : Map[String, Bool] = {}
  let queue : Array[String] = []
  for node in nodes {
    if initial.get(node.id) is Some(_) {
      affected[node.id] = true
      queue.push(node.id)
    }
  }
  while queue.length() > 0 {
    let current = queue.pop().unwrap_or("")
    if current.length() == 0 {
      continue
    }
    for neighbor in neighbors.get(current).unwrap_or([]) {
      if affected.get(neighbor) is Some(_) {
        continue
      }
      affected[neighbor] = true
      queue.push(neighbor)
    }
  }
  affected
}

///|
pub fn flow_cache_key(task : String, node_id : String) -> String {
  task + "::" + node_id
}

///|
pub fn flow_fingerprint(
  task : String,
  task_cmd : String,
  node : FlowNode,
  signatures : Map[String, String],
) -> String {
  let buf = StringBuilder::new()
  buf.write_string("task=")
  buf.write_string(task)
  buf.write_string("\nnode=")
  buf.write_string(node.id)
  buf.write_string("\ncommand=")
  buf.write_string(task_cmd)
  buf.write_string("\nself=")
  buf.write_string(signatures.get(node.id).unwrap_or("missing"))
  for dep in node.depends_on {
    buf.write_string("\ndep:")
    buf.write_string(dep)
    buf.write_string("=")
    buf.write_string(signatures.get(dep).unwrap_or("missing"))
  }
  buf.to_string()
}
