import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("flaker setup init --adapter --runner", () => {
  let dir: string;
  const cliPath = join(process.cwd(), "dist/cli/main.js");

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flaker-init-"));
    execSync("git init -q", { cwd: dir });
    execSync("git remote add origin https://github.com/acme/demo.git", { cwd: dir });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes [adapter] and [runner] sections when flags are provided", () => {
    execSync(`node ${cliPath} setup init --adapter vitest --runner vitest`, { cwd: dir, stdio: "pipe" });
    const toml = readFileSync(join(dir, "flaker.toml"), "utf-8");
    expect(toml).toMatch(/\[adapter\][\s\S]*type = "vitest"/);
    expect(toml).toMatch(/\[runner\][\s\S]*type = "vitest"/);
  });

  it("writes playwright adapter with correct section when --adapter playwright", () => {
    execSync(`node ${cliPath} setup init --adapter playwright`, { cwd: dir, stdio: "pipe" });
    const toml = readFileSync(join(dir, "flaker.toml"), "utf-8");
    expect(toml).toMatch(/\[adapter\][\s\S]*type = "playwright"/);
  });

  it("writes runner command matching the runner type", () => {
    execSync(`node ${cliPath} setup init --runner jest`, { cwd: dir, stdio: "pipe" });
    const toml = readFileSync(join(dir, "flaker.toml"), "utf-8");
    expect(toml).toMatch(/\[runner\][\s\S]*type = "jest"/);
    expect(toml).toMatch(/command = "pnpm exec jest"/);
  });

  it("produces default sections when no flags provided", () => {
    execSync(`node ${cliPath} setup init`, { cwd: dir, stdio: "pipe" });
    const toml = readFileSync(join(dir, "flaker.toml"), "utf-8");
    // Default adapter is playwright, default runner is vitest
    expect(toml).toMatch(/\[adapter\][\s\S]*type = "playwright"/);
    expect(toml).toMatch(/\[runner\][\s\S]*type = "vitest"/);
  });

  it("rejects unknown adapter values", () => {
    expect(() =>
      execSync(`node ${cliPath} setup init --adapter frobnitz`, { cwd: dir, stdio: "pipe" })
    ).toThrow();
  });

  it("rejects unknown runner values", () => {
    expect(() =>
      execSync(`node ${cliPath} setup init --runner frobnitz`, { cwd: dir, stdio: "pipe" })
    ).toThrow();
  });
});
