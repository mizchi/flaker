import { describe, it, expect, vi } from "vitest";
import { loadCore } from "../../src/cli/core/loader.js";

describe("BitflowNativeResolver", () => {
  it("resolves affected targets via MoonBit core (no CLI)", async () => {
    const core = await loadCore();
    const workflow = [
      'workflow(name="ci")',
      'node(id="auth", depends_on=[])',
      'node(id="home", depends_on=[])',
      'task(id="test-auth", node="auth", cmd="test", needs=[], srcs=["src/auth/**"])',
      'task(id="test-home", node="home", cmd="test", needs=[], srcs=["src/home/**"])',
    ].join("\n");
    const result = core.resolveAffected(workflow, ["src/auth/login.ts"]);
    expect(result).toContain("test-auth");
    expect(result).not.toContain("test-home");
  });

  it("returns empty for no matching paths", async () => {
    const core = await loadCore();
    const workflow = [
      'workflow(name="ci")',
      'node(id="auth", depends_on=[])',
      'task(id="test-auth", node="auth", cmd="test", needs=[], srcs=["src/auth/**"])',
    ].join("\n");
    const result = core.resolveAffected(workflow, ["src/payments/stripe.ts"]);
    expect(result).toEqual([]);
  });

  it("expands transitive task dependencies", async () => {
    const core = await loadCore();
    const workflow = [
      'workflow(name="ci")',
      'node(id="lib", depends_on=[])',
      'node(id="app", depends_on=["lib"])',
      'task(id="lib", node="lib", cmd="test", needs=[], srcs=["src/lib/**"])',
      'task(id="app", node="app", cmd="test", needs=["lib"], srcs=["src/app/**"])',
    ].join("\n");
    const result = core.resolveAffected(workflow, ["src/lib/core.ts"]);
    expect(result).toContain("lib");
    expect(result).toContain("app");
  });

  it("filters affected targets against known test files", async () => {
    const core = await loadCore();
    const workflow = [
      'workflow(name="ci")',
      'node(id="auth", depends_on=[])',
      'node(id="home", depends_on=[])',
      'task(id="test-auth", node="auth", cmd="test", needs=[], srcs=["src/auth/**"])',
      'task(id="test-home", node="home", cmd="test", needs=[], srcs=["src/home/**"])',
    ].join("\n");

    const affectedTargets = core.resolveAffected(workflow, ["src/auth/login.ts", "src/home/index.ts"]);
    // Simulate BitflowNativeResolver filtering against known test files
    const allTestFiles = new Set(["test-auth"]);
    const filtered = affectedTargets.filter(t => allTestFiles.has(t));
    expect(filtered).toEqual(["test-auth"]);
  });
});
