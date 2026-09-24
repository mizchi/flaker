import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("flaker import --ci", () => {
  it("is documented in import --help", () => {
    const res = spawnSync("node", [CLI, "import", "--help"], { encoding: "utf8" });
    expect(res.stdout).toContain("--ci");
    expect(res.stdout).toContain("--days <n>");
  });

  it("requires GITHUB_TOKEN and says so", () => {
    const dir = mkdtempSync(join(tmpdir(), "flaker-import-ci-"));
    writeFileSync(join(dir, "flaker.toml"), `[repo]\nowner = "a"\nname = "b"\n`);
    const env = { ...process.env };
    delete env["GITHUB_TOKEN"];
    const res = spawnSync("node", [CLI, "import", "--ci"], { cwd: dir, encoding: "utf8", env });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("GITHUB_TOKEN environment variable is required");
  });

  it("rejects a file together with --ci", () => {
    const res = spawnSync("node", [CLI, "import", "report.json", "--ci"], { encoding: "utf8" });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("--ci does not take a file");
  });

  it("rejects an invalid --days value", () => {
    const res = spawnSync("node", [CLI, "import", "--ci", "--days", "abc"], { encoding: "utf8" });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("Invalid --days value: abc. Expected a positive integer.");
  });
});
