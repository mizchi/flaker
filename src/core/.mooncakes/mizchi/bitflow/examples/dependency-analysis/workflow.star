workflow(name="dependency-analysis", max_parallel=2)

node(id="core", depends_on=[])
node(id="lib-a", depends_on=["core"])
node(id="lib-b", depends_on=["core"])
node(id="app", depends_on=["lib-a", "lib-b"])

task(
  id="core:build",
  node="core",
  cmd=["pnpm", "--filter", "core", "build"],
  needs=[],
  srcs=["examples/dependency-analysis/project/packages/core/src/**"],
  outs=["examples/dependency-analysis/project/packages/core/dist/**"],
  trigger="auto",
)

task(
  id="lib-a:build",
  node="lib-a",
  cmd=["pnpm", "--filter", "lib-a", "build"],
  needs=["core:build"],
  srcs=["examples/dependency-analysis/project/packages/lib-a/src/**"],
  outs=["examples/dependency-analysis/project/packages/lib-a/dist/**"],
  trigger="auto",
)

task(
  id="lib-b:build",
  node="lib-b",
  cmd=["pnpm", "--filter", "lib-b", "build"],
  needs=["core:build"],
  srcs=["examples/dependency-analysis/project/packages/lib-b/src/**"],
  outs=["examples/dependency-analysis/project/packages/lib-b/dist/**"],
  trigger="auto",
)

task(
  id="app:build",
  node="app",
  cmd=["pnpm", "--filter", "app", "build"],
  needs=["lib-a:build", "lib-b:build"],
  srcs=["examples/dependency-analysis/project/packages/app/src/**"],
  outs=["examples/dependency-analysis/project/packages/app/dist/**"],
  trigger="auto",
)

task(
  id="app:test",
  node="app",
  cmd=["pnpm", "--filter", "app", "test"],
  needs=["app:build"],
  srcs=["examples/dependency-analysis/project/packages/app/tests/**"],
  trigger="manual",
)

entrypoint(targets=["app:test"])
