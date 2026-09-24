// tests/cli/import-selector-cli.test.ts
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");
const FIX = resolve(__filename, "../../fixtures");

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "flaker-import-selector-"));
  writeFileSync(join(dir, "flaker.toml"),
    `[repo]\nowner = "a"\nname = "b"\n[storage]\npath = ".flaker/data"\n[affected]\nresolver = "git"\nconfig = ""\n`);
  return dir;
}

describe("flaker import --adapter jev|selector-record", () => {
  it("imports a jev record and exports its verdicts", () => {
    const dir = repo();
    const res = spawnSync("node", [CLI, "import", join(FIX, "jev/record-v2.json"), "--adapter", "jev"], { cwd: dir, encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/Imported 1 selector run/);
    const out = spawnSync("node", [CLI, "export", "selector_verdicts", "--format", "jsonl"], { cwd: dir, encoding: "utf8" });
    expect(out.stdout.trimEnd().split("\n")).toHaveLength(5);
  });

  it("exits 1 when a file is invalid", () => {
    const dir = repo();
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{}");
    const res = spawnSync("node", [CLI, "import", bad, "--adapter", "selector-record"], { cwd: dir, encoding: "utf8" });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/invalid selector-record/);
  });
});
