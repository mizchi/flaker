import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveActrunWorkflowPath } from "../../src/cli/config.js";

describe("resolveActrunWorkflowPath", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flaker-actrun-config-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("prefers [runner.actrun].workflow when configured", () => {
    writeFileSync(
      join(dir, "flaker.toml"),
      `
[repo]
owner = "test"
name = "repo"

[storage]
path = ".flaker/data"

[adapter]
type = "playwright"

[runner]
type = "playwright"
command = "pnpm exec playwright test -c playwright.config.ts"

[runner.actrun]
workflow = ".github/workflows/flaker-local.yml"
local = true
trust = true

[affected]
resolver = "git"
config = ""

[quarantine]
auto = true
flaky_rate_threshold_percentage = 30
min_runs = 5

[flaky]
window_days = 14
detection_threshold_ratio = 0.1
`.trim(),
    );

    const config = loadConfig(dir);
    expect(config.runner.actrun?.workflow).toBe(".github/workflows/flaker-local.yml");
    expect(config.runner.actrun?.local).toBe(true);
    expect(config.runner.actrun?.trust).toBe(true);
    expect(resolveActrunWorkflowPath(config)).toBe(".github/workflows/flaker-local.yml");
  });

  it("falls back to runner.command when it is already a workflow path", () => {
    writeFileSync(
      join(dir, "flaker.toml"),
      `
[repo]
owner = "test"
name = "repo"

[storage]
path = ".flaker/data"

[adapter]
type = "playwright"

[runner]
type = "playwright"
command = ".github/workflows/ci.yml"

[affected]
resolver = "git"
config = ""

[quarantine]
auto = true
flaky_rate_threshold_percentage = 30
min_runs = 5

[flaky]
window_days = 14
detection_threshold_ratio = 0.1
`.trim(),
    );

    const config = loadConfig(dir);
    expect(resolveActrunWorkflowPath(config)).toBe(".github/workflows/ci.yml");
  });

  it("throws a helpful error when actrun workflow path is missing", () => {
    writeFileSync(
      join(dir, "flaker.toml"),
      `
[repo]
owner = "test"
name = "repo"

[storage]
path = ".flaker/data"

[adapter]
type = "playwright"

[runner]
type = "playwright"
command = "pnpm exec playwright test -c playwright.config.ts"

[affected]
resolver = "git"
config = ""

[quarantine]
auto = true
flaky_rate_threshold_percentage = 30
min_runs = 5

[flaky]
window_days = 14
detection_threshold_ratio = 0.1
`.trim(),
    );

    const config = loadConfig(dir);
    expect(() => resolveActrunWorkflowPath(config)).toThrowError(
      /runner\.actrun.*workflow.*\.github\/workflows\/ci\.yml/,
    );
  });
});
