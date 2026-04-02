import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.js";
import { loadConfig } from "../../src/cli/config.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "flaker-test-"));
}

describe("runInit", () => {
  it("creates flaker.toml with correct content", () => {
    const dir = makeTempDir();
    runInit(dir, { owner: "myorg", name: "myrepo" });

    const tomlPath = join(dir, "flaker.toml");
    expect(existsSync(tomlPath)).toBe(true);

    const content = readFileSync(tomlPath, "utf-8");
    expect(content).toContain('[repo]');
    expect(content).toContain('owner = "myorg"');
    expect(content).toContain('name = "myrepo"');
    expect(content).toContain('[storage]');
    expect(content).toContain('[adapter]');
    expect(content).toContain('type = "playwright"');
    expect(content).toContain('artifact_name = "playwright-report"');
    expect(content).toContain('[runner]');
    expect(content).toContain('[affected]');
    expect(content).toContain('[quarantine]');
    expect(content).toContain('[flaky]');

    expect(existsSync(join(dir, ".flaker"))).toBe(true);
  });
});

describe("loadConfig", () => {
  it("reads and returns parsed config", () => {
    const dir = makeTempDir();
    runInit(dir, { owner: "testowner", name: "testrepo" });

    const config = loadConfig(dir);
    expect(config.repo.owner).toBe("testowner");
    expect(config.repo.name).toBe("testrepo");
    expect(config.storage.path).toBe(".flaker/data");
    expect(config.adapter.type).toBe("playwright");
    expect(config.adapter.artifact_name).toBe("playwright-report");
    expect(config.runner.type).toBe("vitest");
    expect(config.quarantine.auto).toBe(true);
    expect(config.flaky.window_days).toBe(14);
  });

  it("throws if flaker.toml not found", () => {
    const dir = makeTempDir();
    expect(() => loadConfig(dir)).toThrow();
  });
});
