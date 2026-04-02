import { describe, it, expect } from "vitest";
import { loadCore } from "../../src/cli/core/loader.js";
import { BitflowNativeResolver } from "../../src/cli/resolvers/bitflow-native.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

  it("supports multi-line task definitions in TS fallback parser", async () => {
    const core = await loadCore();
    const workflow = [
      'workflow(name="ci")',
      'node(id="auth", depends_on=[])',
      "task(",
      '  id="test-auth",',
      '  node="auth",',
      '  cmd="test",',
      '  needs=[],',
      '  srcs=["src/auth/**"]',
      ")",
    ].join("\n");

    const result = core.resolveAffected(workflow, ["src/auth/login.ts"]);
    expect(result).toContain("test-auth");
  });

  it("supports single-quoted workflow values in TS fallback parser", async () => {
    const core = await loadCore();
    const workflow = [
      "workflow(name='ci')",
      "node(id='auth', depends_on=[])",
      "task(id='test-auth', node='auth', cmd='test', needs=[], srcs=['src/auth/**'])",
    ].join("\n");
    const result = core.resolveAffected(workflow, ["src/auth/login.ts"]);
    expect(result).toContain("test-auth");
  });

  it("matches changed paths with Windows separators", async () => {
    const core = await loadCore();
    const workflow = [
      'workflow(name="ci")',
      'node(id="auth", depends_on=[])',
      'task(id="test-auth", node="auth", cmd="test", needs=[], srcs=["src/auth/**"])',
    ].join("\n");
    const result = core.resolveAffected(workflow, ["src\\auth\\login.ts"]);
    expect(result).toContain("test-auth");
  });

  it("explains direct and dependency-expanded bitflow tasks", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "bitflow-native-"));
    try {
      const configPath = join(tmpDir, "workflow.star");
      writeFileSync(
        configPath,
        [
          'workflow(name="ci")',
          'node(id="lib", depends_on=[])',
          'node(id="app", depends_on=["lib"])',
          'task(id="lib", node="lib", cmd="test", needs=[], srcs=["src/lib/**"])',
          'task(id="app", node="app", cmd="test", needs=["lib"], srcs=["src/app/**"])',
        ].join("\n"),
      );
      const resolver = new BitflowNativeResolver(configPath);
      const report = await resolver.explain?.(
        ["src/lib/core.ts", "docs/notes.md"],
        [
          { spec: "tests/lib.spec.ts", taskId: "lib", filter: null },
          { spec: "tests/app.spec.ts", taskId: "app", filter: null },
        ],
      );

      expect(report?.matched.map((entry) => entry.taskId)).toEqual(["lib"]);
      expect(
        report?.selected.find((entry) => entry.taskId === "app"),
      ).toMatchObject({
        direct: false,
        includedBy: ["lib"],
      });
      expect(report?.unmatched).toEqual(["docs/notes.md"]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
