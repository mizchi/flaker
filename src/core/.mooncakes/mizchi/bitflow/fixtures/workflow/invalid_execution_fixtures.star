# source=external-file
# case=duplicate_node_id
workflow(name="ci")
node(id="root", depends_on=[])
node(id="root", depends_on=[])
task(id="root:build", node="root", cmd="build", needs=[])
entrypoint(targets=["root:build"])
# expect.ok=false
# expect.state=invalid
# expect.order=
# expect.steps=
# expect.issues_contains=node: duplicate node id 'root'
---
# case=node_depends_on_unknown_node
workflow(name="ci")
node(id="root", depends_on=["missing"])
task(id="root:build", node="root", cmd="build", needs=[])
entrypoint(targets=["root:build"])
# expect.ok=false
# expect.state=invalid
# expect.order=
# expect.steps=
# expect.issues_contains=node: node 'root' depends on unknown node 'missing'
---
# case=node_dependency_cycle
workflow(name="ci")
node(id="a", depends_on=["b"])
node(id="b", depends_on=["a"])
task(id="a:build", node="a", cmd="build", needs=[])
entrypoint(targets=["a:build"])
# expect.ok=false
# expect.state=invalid
# expect.order=
# expect.steps=
# expect.issues_contains=node: dependency graph has a cycle
---
# case=duplicate_task_id
workflow(name="ci")
node(id="root", depends_on=[])
task(id="root:build", node="root", cmd="build", needs=[])
task(id="root:build", node="root", cmd="test", needs=[])
entrypoint(targets=["root:build"])
# expect.ok=false
# expect.state=invalid
# expect.order=
# expect.steps=
# expect.issues_contains=duplicate task id 'root:build'
---
# case=task_targets_unknown_node
workflow(name="ci")
node(id="root", depends_on=[])
task(id="dep:build", node="dep", cmd="build", needs=[])
entrypoint(targets=["dep:build"])
# expect.ok=false
# expect.state=invalid
# expect.order=
# expect.steps=
# expect.issues_contains=targets unknown node 'dep'
---
# case=task_depends_on_unknown_task
workflow(name="ci")
node(id="root", depends_on=[])
task(id="root:test", node="root", cmd="test", needs=["root:build"])
entrypoint(targets=["root:test"])
# expect.ok=false
# expect.state=invalid
# expect.order=
# expect.steps=
# expect.issues_contains=depends on unknown task 'root:build'
---
# case=task_graph_cycle
workflow(name="ci")
node(id="root", depends_on=[])
task(id="root:a", node="root", cmd="a", needs=["root:b"])
task(id="root:b", node="root", cmd="b", needs=["root:a"])
entrypoint(targets=["root:a"])
# expect.ok=false
# expect.state=invalid
# expect.order=
# expect.steps=
# expect.issues_contains=task graph has a cycle
---
# case=entry_target_missing
workflow(name="ci")
node(id="root", depends_on=[])
task(id="root:build", node="root", cmd="build", needs=[])
entrypoint(targets=["root:test"])
# expect.ok=false
# expect.state=invalid
# expect.order=
# expect.steps=
# expect.issues_contains=entry target 'root:test' does not exist
---
# case=multiple_missing_entry_targets
workflow(name="ci")
node(id="root", depends_on=[])
task(id="root:build", node="root", cmd="build", needs=[])
entrypoint(targets=["root:test", "root:deploy"])
# expect.ok=false
# expect.state=invalid
# expect.order=
# expect.steps=
# expect.issues_contains=entry target 'root:test' does not exist,entry target 'root:deploy' does not exist
# expect.issues_count=2
---
# case=task_cycle_and_unknown_dependency
workflow(name="ci")
node(id="root", depends_on=[])
task(id="root:a", node="root", cmd="a", needs=["root:b", "root:missing"])
task(id="root:b", node="root", cmd="b", needs=["root:a"])
entrypoint(targets=["root:a"])
# expect.ok=false
# expect.state=invalid
# expect.order=
# expect.steps=
# expect.issues_contains=task 'root:a' depends on unknown task 'root:missing',task graph has a cycle
# expect.issues_count=2
---
# case=mixed_node_and_task_issues
workflow(name="ci")
node(id="root", depends_on=["missing"])
task(id="dup", node="root", cmd="build", needs=["missing:task"])
task(id="dup", node="ghost", cmd="test", needs=["missing:task"])
entrypoint(targets=["missing:entry"])
# expect.ok=false
# expect.state=invalid
# expect.order=
# expect.steps=
# expect.issues_contains=node: node 'root' depends on unknown node 'missing',duplicate task id 'dup',task 'dup' targets unknown node 'ghost',task 'dup' depends on unknown task 'missing:task',entry target 'missing:entry' does not exist
# expect.issues_count=6
---
# case=while_inline_duplicate_task_ids
counter = 0
workflow(name="ci")
node(id="n", depends_on=[])
while counter < 2: task(id="n:dup", node="n", cmd="run", needs=[]); counter = counter + 1
entrypoint(targets=["n:dup"])
# expect.ok=false
# expect.state=invalid
# expect.order=
# expect.steps=
# expect.issues_contains=duplicate task id 'n:dup'
