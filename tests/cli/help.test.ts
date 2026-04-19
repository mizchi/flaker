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
    expect(help).toContain("Advanced:");
  });

  it("shows run help with --dry-run and --explain flags", () => {
    const program = createProgram();
    // exec category removed in 0.8.0 — use top-level run command.
    const runCmd = program.commands.find((command) => command.name() === "run");
    const runHelp = runCmd?.helpInformation();
    // gate/quarantine commands removed in 0.8.0 — lookups deleted.
    const opsCmd = program.commands.find((command) => command.name() === "ops");
    const opsDailyHelp = opsCmd?.commands.find((command) => command.name() === "daily")?.helpInformation();
    const opsIncidentHelp = opsCmd?.commands.find((command) => command.name() === "incident")?.helpInformation();
    const opsWeeklyHelp = opsCmd?.commands.find((command) => command.name() === "weekly")?.helpInformation();
    // analyze subcommands (eval, bundle, flaky-tag) removed in 0.8.0 — lookups deleted.
    // import report subcommand removed in 0.8.0 — use top-level import <file>.

    expect(runHelp).toContain("--dry-run");
    expect(runHelp).toContain("--explain");
    expect(runHelp).toContain("--gate");
    expect(runHelp).toContain("--cluster-mode");
    expect(runHelp).toContain("--skip-flaky-tagged");
    // gateReviewHelp, gateExplainHelp, gateHistoryHelp assertions removed — gate dropped in 0.8.0.
    // quarantineSuggestHelp, quarantineApplyHelp assertions removed — quarantine dropped in 0.8.0.
    expect(opsDailyHelp).toContain("--window-days");
    expect(opsDailyHelp).toContain("--json");
    expect(opsIncidentHelp).toContain("--suite");
    expect(opsIncidentHelp).toContain("--test");
    expect(opsIncidentHelp).toContain("--run");
    expect(opsWeeklyHelp).toContain("--window-days");
    expect(opsWeeklyHelp).toContain("--json");
    // evalHelp, bundleHelp, flakyTagHelp assertions removed — commands dropped in 0.8.0.
    // importReportHelp assertion removed — import report subcommand dropped in 0.8.0.
  });
});
