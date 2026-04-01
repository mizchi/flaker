# source=external-file
# case=required_failure_blocks_dependent
# scenario root:build=fail:build failed
workflow(name="ci")
node(id="root", depends_on=[])
node(id="dep", depends_on=["root"])
task(id="root:build", node="root", cmd="build", needs=[])
task(id="dep:test", node="dep", cmd="test", needs=["root:build"])
entrypoint(targets=["dep:test"])
# expect.ok=false
# expect.state=partial_failed
# expect.order=root:build,dep:test
# expect.steps=root:build:failed,dep:test:blocked
---
# case=optional_failure_keeps_completed
# scenario root:lint=fail:lint failed
workflow(name="ci")
node(id="root", depends_on=[])
task(id="root:lint", node="root", cmd="lint", needs=[], required=False)
entrypoint(targets=["root:lint"])
# expect.ok=true
# expect.state=completed
# expect.order=root:lint
# expect.steps=root:lint:failed
---
# case=all_success_chain
workflow(name="ci")
node(id="base", depends_on=[])
node(id="app", depends_on=["base"])
task(id="base:prep", node="base", cmd="prep", needs=[])
task(id="app:build", node="app", cmd="build", needs=["base:prep"])
task(id="app:test", node="app", cmd="test", needs=["app:build"])
entrypoint(targets=["app:test"])
# expect.ok=true
# expect.state=completed
# expect.order=base:prep,app:build,app:test
# expect.steps=base:prep:success,app:build:success,app:test:success
---
# case=entrypoint_scopes_transitive_only
workflow(name="ci")
node(id="root", depends_on=[])
node(id="app", depends_on=["root"])
node(id="misc", depends_on=[])
task(id="root:prep", node="root", cmd="prep", needs=[])
task(id="app:build", node="app", cmd="build", needs=["root:prep"])
task(id="misc:lint", node="misc", cmd="lint", needs=[])
entrypoint(targets=["app:build"])
# expect.ok=true
# expect.state=completed
# expect.order=root:prep,app:build
# expect.steps=root:prep:success,app:build:success
---
# case=two_entry_targets_share_dependency
workflow(name="ci")
node(id="root", depends_on=[])
node(id="app", depends_on=["root"])
task(id="root:prep", node="root", cmd="prep", needs=[])
task(id="app:build", node="app", cmd="build", needs=["root:prep"])
task(id="app:lint", node="app", cmd="lint", needs=["root:prep"])
entrypoint(targets=["app:build", "app:lint"])
# expect.ok=true
# expect.state=completed
# expect.order=root:prep,app:build,app:lint
# expect.steps=root:prep:success,app:build:success,app:lint:success
---
# case=optional_failure_blocks_required_dependent
# scenario root:seed=fail:seed failed
workflow(name="ci")
node(id="root", depends_on=[])
node(id="app", depends_on=["root"])
task(id="root:seed", node="root", cmd="seed", needs=[], required=False)
task(id="app:use", node="app", cmd="use", needs=["root:seed"])
entrypoint(targets=["app:use"])
# expect.ok=false
# expect.state=partial_failed
# expect.order=root:seed,app:use
# expect.steps=root:seed:failed,app:use:blocked
---
# case=optional_failure_blocks_optional_dependent
# scenario root:seed=fail:seed failed
workflow(name="ci")
node(id="root", depends_on=[])
node(id="app", depends_on=["root"])
task(id="root:seed", node="root", cmd="seed", needs=[], required=False)
task(id="app:use", node="app", cmd="use", needs=["root:seed"], required=False)
entrypoint(targets=["app:use"])
# expect.ok=true
# expect.state=completed
# expect.order=root:seed,app:use
# expect.steps=root:seed:failed,app:use:blocked
---
# case=required_failure_does_not_stop_independent_task
# scenario root:build=fail:build failed
workflow(name="ci")
node(id="root", depends_on=[])
node(id="util", depends_on=[])
task(id="root:build", node="root", cmd="build", needs=[])
task(id="util:lint", node="util", cmd="lint", needs=[])
entrypoint(targets=["root:build", "util:lint"])
# expect.ok=false
# expect.state=partial_failed
# expect.order=root:build,util:lint
# expect.steps=root:build:failed,util:lint:success
---
# case=no_scenario_defaults_to_success
workflow(name="ci")
node(id="root", depends_on=[])
node(id="dep", depends_on=["root"])
task(id="root:build", node="root", cmd="build", needs=[])
task(id="dep:test", node="dep", cmd="test", needs=["root:build"])
entrypoint(targets=["dep:test"])
# expect.ok=true
# expect.state=completed
# expect.order=root:build,dep:test
# expect.steps=root:build:success,dep:test:success
---
# case=max_parallel_batches_preserve_queue_order
workflow(name="ci", max_parallel=2)
node(id="n", depends_on=[])
task(id="n:a", node="n", cmd="a", needs=[])
task(id="n:b", node="n", cmd="b", needs=[])
task(id="n:c", node="n", cmd="c", needs=[])
task(id="n:d", node="n", cmd="d", needs=[])
entrypoint(targets=["n:a", "n:b", "n:c", "n:d"])
# expect.ok=true
# expect.state=completed
# expect.order=n:a,n:b,n:c,n:d
# expect.steps=n:a:success,n:b:success,n:c:success,n:d:success
---
# case=no_entrypoint_runs_all_tasks
workflow(name="ci")
node(id="root", depends_on=[])
node(id="util", depends_on=[])
task(id="root:build", node="root", cmd="build", needs=[])
task(id="util:lint", node="util", cmd="lint", needs=[])
# expect.ok=true
# expect.state=completed
# expect.order=root:build,util:lint
# expect.steps=root:build:success,util:lint:success
---
# case=default_runner_failure_causes_required_failure
# runner.default_ok=false
# runner.default_message=default failed
workflow(name="ci")
node(id="root", depends_on=[])
task(id="root:build", node="root", cmd="build", needs=[])
entrypoint(targets=["root:build"])
# expect.ok=false
# expect.state=partial_failed
# expect.order=root:build
# expect.steps=root:build:failed
---
# case=scenario_success_overrides_default_failure
# runner.default_ok=false
# scenario n:a=success:done
workflow(name="ci")
node(id="n", depends_on=[])
task(id="n:a", node="n", cmd="a", needs=[])
task(id="n:b", node="n", cmd="b", needs=[])
entrypoint(targets=["n:a", "n:b"])
# expect.ok=false
# expect.state=partial_failed
# expect.order=n:a,n:b
# expect.steps=n:a:success,n:b:failed
---
# case=scenario_failure_overrides_default_success
# runner.default_ok=true
# scenario n:a=fail:boom
workflow(name="ci")
node(id="n", depends_on=[])
task(id="n:a", node="n", cmd="a", needs=[])
entrypoint(targets=["n:a"])
# expect.ok=false
# expect.state=partial_failed
# expect.order=n:a
# expect.steps=n:a:failed
---
# case=manual_trigger_mode_executes_normally
workflow(name="ci")
node(id="n", depends_on=[])
task(id="n:manual", node="n", cmd="manual", needs=[], trigger="manual")
entrypoint(targets=["n:manual"])
# expect.ok=true
# expect.state=completed
# expect.order=n:manual
# expect.steps=n:manual:success
---
# case=entrypoint_manual_target_does_not_select_unrelated_auto
workflow(name="ci")
node(id="n", depends_on=[])
task(id="n:manual", node="n", cmd="manual", needs=[], trigger="manual")
task(id="n:auto", node="n", cmd="auto", needs=[])
entrypoint(targets=["n:manual"])
# expect.ok=true
# expect.state=completed
# expect.order=n:manual
# expect.steps=n:manual:success
---
# case=diamond_failure_blocks_join
# scenario n:right=fail:right failed
workflow(name="ci")
node(id="n", depends_on=[])
task(id="n:root", node="n", cmd="root", needs=[])
task(id="n:left", node="n", cmd="left", needs=["n:root"])
task(id="n:right", node="n", cmd="right", needs=["n:root"])
task(id="n:join", node="n", cmd="join", needs=["n:left", "n:right"])
entrypoint(targets=["n:join"])
# expect.ok=false
# expect.state=partial_failed
# expect.order=n:root,n:left,n:right,n:join
# expect.steps=n:root:success,n:left:success,n:right:failed,n:join:blocked
---
# case=optional_failed_and_optional_blocked_can_complete_with_required_success
# scenario n:seed=fail:seed failed
workflow(name="ci")
node(id="n", depends_on=[])
task(id="n:seed", node="n", cmd="seed", needs=[], required=False)
task(id="n:use", node="n", cmd="use", needs=["n:seed"], required=False)
task(id="n:check", node="n", cmd="check", needs=[])
entrypoint(targets=["n:use", "n:check"])
# expect.ok=true
# expect.state=completed
# expect.order=n:seed,n:check,n:use
# expect.steps=n:seed:failed,n:check:success,n:use:blocked
---
# case=max_parallel_two_two_stage
workflow(name="ci", max_parallel=2)
node(id="n", depends_on=[])
task(id="n:a", node="n", cmd="a", needs=[])
task(id="n:b", node="n", cmd="b", needs=[])
task(id="n:c", node="n", cmd="c", needs=["n:a"])
task(id="n:d", node="n", cmd="d", needs=["n:b"])
entrypoint(targets=["n:a", "n:b", "n:c", "n:d"])
# expect.ok=true
# expect.state=completed
# expect.order=n:a,n:b,n:c,n:d
# expect.steps=n:a:success,n:b:success,n:c:success,n:d:success
---
# case=multiple_entry_components_transitive
workflow(name="ci")
node(id="n", depends_on=[])
task(id="n:a1", node="n", cmd="a1", needs=[])
task(id="n:a2", node="n", cmd="a2", needs=["n:a1"])
task(id="n:b1", node="n", cmd="b1", needs=[])
task(id="n:b2", node="n", cmd="b2", needs=["n:b1"])
entrypoint(targets=["n:a2", "n:b2"])
# expect.ok=true
# expect.state=completed
# expect.order=n:a1,n:b1,n:a2,n:b2
# expect.steps=n:a1:success,n:b1:success,n:a2:success,n:b2:success
---
# case=redundant_entry_targets_deduplicated
workflow(name="ci")
node(id="n", depends_on=[])
task(id="n:build", node="n", cmd="build", needs=[])
task(id="n:test", node="n", cmd="test", needs=["n:build"])
entrypoint(targets=["n:test", "n:build"])
# expect.ok=true
# expect.state=completed
# expect.order=n:build,n:test
# expect.steps=n:build:success,n:test:success
---
# case=required_failure_blocks_optional_dependent_and_reports_partial
# scenario n:root=fail:root failed
workflow(name="ci")
node(id="n", depends_on=[])
task(id="n:root", node="n", cmd="root", needs=[])
task(id="n:opt", node="n", cmd="opt", needs=["n:root"], required=False)
entrypoint(targets=["n:opt"])
# expect.ok=false
# expect.state=partial_failed
# expect.order=n:root,n:opt
# expect.steps=n:root:failed,n:opt:blocked
---
# case=optional_failure_independent_of_required_success_completed
# scenario n:opt=fail:optional failed
workflow(name="ci")
node(id="n", depends_on=[])
task(id="n:opt", node="n", cmd="opt", needs=[], required=False)
task(id="n:req", node="n", cmd="req", needs=[])
entrypoint(targets=["n:opt", "n:req"])
# expect.ok=true
# expect.state=completed
# expect.order=n:opt,n:req
# expect.steps=n:opt:failed,n:req:success
---
# case=while_inline_expands_multiple_tasks
counter = 0
workflow(name="ci")
node(id="n", depends_on=[])
while counter < 3: task(id="n:" + str(counter), node="n", cmd="run", needs=[]); counter = counter + 1
entrypoint(targets=["n:0", "n:1", "n:2"])
# expect.ok=true
# expect.state=completed
# expect.order=n:0,n:1,n:2
# expect.steps=n:0:success,n:1:success,n:2:success
