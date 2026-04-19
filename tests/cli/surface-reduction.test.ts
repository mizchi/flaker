import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

/**
 * The 0.7.0 surface reduction contract.
 * The "Primary commands:" block of `flaker --help` MUST list exactly these
 * 11 entries (10 primary + `report` for IO). Adding a new primary command
 * requires updating this list AND the 2026-04-19 plan doc.
 */
const PRIMARY = [
  "init",
  "plan",
  "apply",
  "status",
  "run",
  "doctor",
  "debug",
  "query",
  "explain",
  "import",
  "report",
];

describe("primary command surface", () => {
  it("lists exactly the 11 primary entries before 'Advanced'", () => {
    const res = spawnSync("node", [CLI, "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    const stdout = res.stdout;
    const primaryStart = stdout.indexOf("Primary commands:");
    const advancedStart = stdout.indexOf("Advanced:");
    expect(primaryStart).toBeGreaterThan(-1);
    expect(advancedStart).toBeGreaterThan(primaryStart);
    const block = stdout.slice(primaryStart, advancedStart);

    // Each PRIMARY name must appear as a left-aligned command token.
    // Use a word-boundary-ish match on `  <name>  ` or `  <name> --` prefix
    // at column position to avoid false positives from the description text.
    for (const name of PRIMARY) {
      // name is on its own word, followed by at least one space and a
      // description (command listings use fixed-width padding). Allow
      // optional arg like "run --gate <...>"
      const pattern = new RegExp(`(?:^|\\n)\\s+${name}(?:\\s|$|\\s--)`);
      expect(block).toMatch(pattern);
    }
  });

  it("does not list any deprecated command in the Primary block", () => {
    const res = spawnSync("node", [CLI, "--help"], { encoding: "utf8" });
    const stdout = res.stdout;
    const primaryStart = stdout.indexOf("Primary commands:");
    const advancedStart = stdout.indexOf("Advanced:");
    const block = stdout.slice(primaryStart, advancedStart);

    // Sanity: ensure legacy names don't accidentally leak back into Primary.
    const LEAKAGE_GUARDS = ["exec", "setup init", "collect ci", "analyze kpi", "policy quarantine"];
    for (const leak of LEAKAGE_GUARDS) {
      expect(block).not.toContain(leak);
    }
  });
});
