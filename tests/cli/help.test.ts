import { describe, expect, it } from "vitest";
import { createProgram } from "../../src/cli/main.js";

describe("CLI help", () => {
  it("shows getting started guide in root help", () => {
    const program = createProgram();

    const help = program.helpInformation();

    expect(help).toContain("Intelligent test selection");
    expect(help).toContain("Getting started");
    expect(help).toContain("flaker init");
    expect(help).toContain("flaker doctor");
    expect(help).toContain("flaker run --gate merge");
    expect(help).toContain("gate");
    expect(help).toContain("Primary commands");
    expect(help).not.toContain("Advanced:");
  });

  it("shows run help with --dry-run and --explain flags", () => {
    const program = createProgram();
    // exec category removed in 0.8.0 — use top-level run command.
    const runCmd = program.commands.find((command) => command.name() === "run");
    const runHelp = runCmd?.helpInformation();
    // gate/quarantine commands removed in 0.8.0 — lookups deleted.
    // ops group removed in 0.13.0 — lookups deleted.
    // analyze subcommands (eval, bundle, flaky-tag) removed in 0.8.0 — lookups deleted.
    // import report subcommand removed in 0.8.0 — use top-level import <file>.

    expect(runHelp).toContain("--dry-run");
    expect(runHelp).toContain("--explain");
    expect(runHelp).toContain("--gate");
    expect(runHelp).toContain("--skip-flaky-tagged");
    // gateReviewHelp, gateExplainHelp, gateHistoryHelp assertions removed — gate dropped in 0.8.0.
    // quarantineSuggestHelp, quarantineApplyHelp assertions removed — quarantine dropped in 0.8.0.
    // opsDailyHelp assertions removed — ops daily dropped in 0.10.0.
    // opsIncidentHelp, opsWeeklyHelp assertions removed — ops dropped in 0.13.0.
    // evalHelp, bundleHelp, flakyTagHelp assertions removed — commands dropped in 0.8.0.
    // importReportHelp assertion removed — import report subcommand dropped in 0.8.0.
  });
});
