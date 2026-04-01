# source=external-file
workflow(1+2 = 3) ### "keyword argument must have form name=expr"
---
workflow(name="ci")
node(id="root", depends_on=[])
task(id="root:build", node="root", cmd="build", *, needs=[]) ### "splat arguments are not supported"
---
workflow(name="ci",
### "expected ')' to close argument list"
---
workflow(name="ci",)
node(id="root", depends_on=[],)
task(id="root:build", node="root", cmd="build", needs=[],)
entrypoint(targets=["root:build"],)
---
workflow(name="ci")
node(id="root", depends_on=[])
task(id="root:build", node="root", cmd="\x-0", needs=[]) ### "invalid escape sequence"
