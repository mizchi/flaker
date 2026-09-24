import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("flaker init generates [gate.*] defaults", () => {
  it("writes [gate.iteration] / [gate.merge] / [gate.release] with sensible strategies", () => {
    const dir = mkdtempSync(join(tmpdir(), "flaker-init-"));
    try {
      const res = spawnSync("node", [CLI, "init", "--owner", "o", "--name", "r", "--adapter", "playwright", "--runner", "playwright"], {
        cwd: dir,
        encoding: "utf8",
      });
      expect(res.status).toBe(0);
      const toml = readFileSync(join(dir, "flaker.toml"), "utf8");
      expect(toml).toContain("[gate.iteration]");
      expect(toml).toContain('strategy = "affected"');
      expect(toml).toContain("[gate.merge]");
      expect(toml).toMatch(/\[gate\.merge\][\s\S]*strategy = "hybrid"/);
      expect(toml).toContain("[gate.release]");
      expect(toml).toMatch(/\[gate\.release\][\s\S]*strategy = "full"/);
      expect(toml).not.toContain("[profile.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
