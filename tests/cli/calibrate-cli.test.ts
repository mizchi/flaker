import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "flaker-calibrate-"));
  writeFileSync(
    join(dir, "flaker.toml"),
    `[repo]\nowner = "a"\nname = "b"\n[storage]\npath = ".flaker/data"\n[affected]\nresolver = "git"\nconfig = ""\n`,
  );
  return dir;
}

describe("flaker calibrate", () => {
  it("is listed in the top-level help", () => {
    const res = spawnSync("node", [CLI, "--help"], { encoding: "utf8" });
    expect(res.stdout).toMatch(/^\s+calibrate\b/m);
  });

  it("--dry-run --json reports a recommendation without touching flaker.toml", () => {
    const dir = repo();
    const before = readFileSync(join(dir, "flaker.toml"), "utf8");
    const res = spawnSync("node", [CLI, "calibrate", "--dry-run", "--json"], { cwd: dir, encoding: "utf8" });
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout) as { sampling: { strategy: string }; written: boolean };
    expect(out.sampling.strategy).toBe("hybrid");
    expect(out.written).toBe(false);
    expect(readFileSync(join(dir, "flaker.toml"), "utf8")).toBe(before);
  });

  it("writes [sampling] without --dry-run", () => {
    const dir = repo();
    const res = spawnSync("node", [CLI, "calibrate"], { cwd: dir, encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(readFileSync(join(dir, "flaker.toml"), "utf8")).toMatch(/\[sampling\]\nstrategy = "hybrid"/);
  });

  it("rejects a non-numeric --window-days", () => {
    const dir = repo();
    const before = readFileSync(join(dir, "flaker.toml"), "utf8");
    const res = spawnSync("node", [CLI, "calibrate", "--window-days", "abc"], { cwd: dir, encoding: "utf8" });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/Invalid --window-days value: abc\. Expected a positive integer\./);
    expect(readFileSync(join(dir, "flaker.toml"), "utf8")).toBe(before);
  });

  it("--selector --dry-run --json reports a keep on an empty database", () => {
    const dir = repo();
    const res = spawnSync("node", [CLI, "calibrate", "--selector", "--dry-run", "--json"], { cwd: dir, encoding: "utf8" });
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout) as { selector: string; decision: { decision: string }; written: boolean };
    expect(out).toMatchObject({ selector: "jev", decision: { decision: "keep" }, written: false });
  });

  it("--selector with another name exits 2", () => {
    const res = spawnSync("node", [CLI, "calibrate", "--selector", "other"], { cwd: repo(), encoding: "utf8" });
    expect(res.status).toBe(2);
  });

  it("bare calibrate still writes [sampling] and touches no gate", () => {
    const dir = repo();
    const res = spawnSync("node", [CLI, "calibrate", "--dry-run", "--json"], { cwd: dir, encoding: "utf8" });
    expect(JSON.parse(res.stdout).sampling.strategy).toBe("hybrid");
  });
});
