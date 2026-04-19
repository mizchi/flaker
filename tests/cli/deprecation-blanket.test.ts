/**
 * Blanket deprecation tests for Task 10.
 * Each deprecated command must emit "deprecated" on stderr and include the
 * canonical pointer when run with --help.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CLI = join(process.cwd(), "dist/cli/main.js");

function helpOf(args: string[]): { stdout: string; stderr: string } {
  const res = spawnSync("node", [CLI, ...args, "--help"], {
    encoding: "utf8",
  });
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const cases: Array<{ cmd: string[]; canonical: string }> = [
  // setup init → flaker init
  { cmd: ["setup", "init"], canonical: "flaker init" },
  // exec run → flaker run
  { cmd: ["exec", "run"], canonical: "flaker run" },
  // exec affected → flaker run --gate iteration --changed <paths>
  { cmd: ["exec", "affected"], canonical: "flaker run" },
  // ops daily → flaker apply
  { cmd: ["ops", "daily"], canonical: "flaker apply" },
  // collect (bare) → flaker apply
  { cmd: ["collect"], canonical: "flaker apply" },
  // collect ci → flaker apply
  { cmd: ["collect", "ci"], canonical: "flaker apply" },
  // collect local → flaker apply
  { cmd: ["collect", "local"], canonical: "flaker apply" },
  // collect coverage → flaker apply
  { cmd: ["collect", "coverage"], canonical: "flaker apply" },
  // collect commit-changes → flaker apply
  { cmd: ["collect", "commit-changes"], canonical: "flaker apply" },
  // collect calibrate → flaker apply
  { cmd: ["collect", "calibrate"], canonical: "flaker apply" },
  // quarantine suggest → flaker apply
  { cmd: ["quarantine", "suggest"], canonical: "flaker apply" },
  // quarantine apply → flaker apply
  { cmd: ["quarantine", "apply"], canonical: "flaker apply" },
  // policy quarantine → flaker apply
  { cmd: ["policy", "quarantine"], canonical: "flaker apply" },
  // policy check → flaker apply
  { cmd: ["policy", "check"], canonical: "flaker apply" },
  // policy quarantine report → flaker apply
  { cmd: ["policy", "quarantine", "report"], canonical: "flaker apply" },
  // gate review → flaker status --gate <name> --detail
  { cmd: ["gate", "review"], canonical: "flaker status" },
  // gate history → flaker status --gate <name>
  { cmd: ["gate", "history"], canonical: "flaker status" },
  // gate explain → flaker status --gate <name> --detail
  { cmd: ["gate", "explain"], canonical: "flaker status" },
  // debug doctor → flaker doctor
  { cmd: ["debug", "doctor"], canonical: "flaker doctor" },
];

describe("deprecation-blanket: deprecated commands emit warning on --help", () => {
  for (const { cmd, canonical } of cases) {
    it(`flaker ${cmd.join(" ")} --help warns and points to ${canonical}`, () => {
      const { stderr } = helpOf(cmd);
      expect(stderr.toLowerCase()).toContain("deprecated");
      expect(stderr).toContain(canonical);
    });
  }
});
