import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("flaker init generates [profile.*] defaults", () => {
  it("writes [profile.local] / [profile.ci] / [profile.scheduled] with sensible strategies", () => {
    const dir = mkdtempSync(join(tmpdir(), "flaker-init-"));
    try {
      const res = spawnSync("node", [CLI, "init", "--owner", "o", "--name", "r", "--adapter", "playwright", "--runner", "playwright"], {
        cwd: dir,
        encoding: "utf8",
      });
      expect(res.status).toBe(0);
      const toml = readFileSync(join(dir, "flaker.toml"), "utf8");
      expect(toml).toContain("[profile.local]");
      expect(toml).toContain('strategy = "affected"');
      expect(toml).toContain("[profile.ci]");
      expect(toml).toMatch(/\[profile\.ci\][\s\S]*strategy = "hybrid"/);
      expect(toml).toContain("[profile.scheduled]");
      expect(toml).toMatch(/\[profile\.scheduled\][\s\S]*strategy = "full"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
