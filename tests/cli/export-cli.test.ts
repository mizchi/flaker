import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");
const REPORT = resolve(__filename, "../../fixtures/vitest-init-report.json");

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "flaker-export-cli-"));
  writeFileSync(
    join(dir, "flaker.toml"),
    `[repo]\nowner = "a"\nname = "b"\n[storage]\npath = ".flaker/data"\n[affected]\nresolver = "git"\nconfig = ""\n`,
  );
  const imported = spawnSync("node", [CLI, "import", REPORT, "--adapter", "vitest", "--commit", "c1", "--source", "ci"], { cwd: dir, encoding: "utf8" });
  expect(imported.status).toBe(0);
  return dir;
}

const run = (dir: string, ...args: string[]) => spawnSync("node", [CLI, "export", ...args], { cwd: dir, encoding: "utf8" });

describe("flaker export", () => {
  it("is listed in the top-level help", () => {
    const res = spawnSync("node", [CLI, "--help"], { encoding: "utf8" });
    expect(res.stdout).toMatch(/^\s+export\b/m);
  });

  it("prints a dataset as jsonl", () => {
    const res = run(repo(), "tests", "--format", "jsonl");
    expect(res.status).toBe(0);
    const rows = res.stdout.trimEnd().split("\n").map((l) => JSON.parse(l));
    expect(rows.map((r) => r.title_path)).toEqual(expect.arrayContaining([["init", "writes toml"], ["init", "reads toml"]]));
  });

  it("writes parquet with -o", () => {
    const dir = repo();
    const res = run(dir, "results", "--format", "parquet", "-o", "out/results.parquet");
    expect(res.status).toBe(0);
    expect(existsSync(join(dir, "out/results.parquet"))).toBe(true);
  });

  it("exits 2 on an unknown dataset, parquet to stdout, and --since without a time column", () => {
    const dir = repo();
    expect(run(dir, "nope").status).toBe(2);
    expect(run(dir, "runs", "--format", "parquet").status).toBe(2);
    expect(run(dir, "flaky", "--since", "2026-01-01").status).toBe(2);
  });

  it("exits 2 without a dataset", () => {
    expect(run(repo()).status).toBe(2);
  });

  it("--projection jev-context writes a v1 context", () => {
    const dir = repo();
    const res = run(dir, "--projection", "jev-context");
    expect(res.status).toBe(0);
    const ctx = JSON.parse(res.stdout);
    expect(ctx.version).toBe(1);
    expect(ctx.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("--projection with a dataset, or with a non-json format, exits 2", () => {
    const dir = repo();
    expect(run(dir, "tests", "--projection", "jev-context").status).toBe(2);
    expect(run(dir, "--projection", "jev-context", "--format", "csv").status).toBe(2);
  });
});
