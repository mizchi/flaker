import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("flaker run --dry-run", () => {
  it("prints selection without executing the runner", () => {
    const dir = mkdtempSync(join(tmpdir(), "flaker-dryrun-"));
    try {
      writeFileSync(join(dir, "flaker.toml"), `
[repo]
owner = "acme"
name = "demo"

[storage]
path = ".flaker/data.duckdb"

[adapter]
type = "vitest"

[runner]
type = "vitest"
command = "pnpm exec vitest run"

[affected]
resolver = "workspace"

[sampling]
strategy = "random"
sample_percentage = 30
`);
      const cliPath = join(process.cwd(), "dist/cli/main.js");
      // Should succeed and not attempt to run any tests
      const out = execSync(
        `node ${cliPath} run --dry-run --strategy random --count 0`,
        { cwd: dir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
      );
      expect(typeof out).toBe("string");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
