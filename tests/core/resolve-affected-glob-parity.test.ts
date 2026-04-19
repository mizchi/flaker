import { describe, it, expect, beforeAll } from "vitest";
import { loadCore, type FlakerCore } from "../../src/cli/core/loader.js";

describe("resolveAffected glob (MoonBit bridge)", () => {
  let core: FlakerCore;

  beforeAll(async () => {
    core = await loadCore();
  });

  it("matches single path segment", () => {
    const workflow = [
      'workflow(name="ci")',
      'node(id="auth", depends_on=[])',
      'task(id="test-auth", node="auth", cmd="test", needs=[], srcs=["src/auth/index.ts"])',
    ].join("\n");

    expect(core.resolveAffected(workflow, ["src/auth/index.ts"])).toContain("test-auth");
    expect(core.resolveAffected(workflow, ["src/other/index.ts"])).toEqual([]);
  });

  it("matches glob patterns in srcs", () => {
    const workflow = [
      'workflow(name="ci")',
      'node(id="auth", depends_on=[])',
      'task(id="test-auth", node="auth", cmd="test", needs=[], srcs=["src/**/index.ts"])',
    ].join("\n");

    expect(core.resolveAffected(workflow, ["src/auth/index.ts"])).toContain("test-auth");
    expect(core.resolveAffected(workflow, ["src/auth/ui/index.ts"])).toContain("test-auth");
    expect(core.resolveAffected(workflow, ["src/auth/index.js"])).toEqual([]);
  });

  it("returns empty for no matching paths", () => {
    const workflow = [
      'workflow(name="ci")',
      'node(id="auth", depends_on=[])',
      'task(id="test-auth", node="auth", cmd="test", needs=[], srcs=["src/auth/**"])',
    ].join("\n");

    expect(core.resolveAffected(workflow, ["lib/util.ts"])).toEqual([]);
  });
});
