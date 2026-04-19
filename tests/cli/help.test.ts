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

  it("shows exec run help with --dry-run and --explain flags", () => {
    const program = createProgram();
    const execCmd = program.commands.find((command) => command.name() === "exec");
    const runCmd = execCmd?.commands.find((command) => command.name() === "run");
    const runHelp = runCmd?.helpInformation();
    const gateCmd = program.commands.find((command) => command.name() === "gate");
    const gateReviewHelp = gateCmd?.commands.find((command) => command.name() === "review")?.helpInformation();
    const gateExplainHelp = gateCmd?.commands.find((command) => command.name() === "explain")?.helpInformation();
    const gateHistoryHelp = gateCmd?.commands.find((command) => command.name() === "history")?.helpInformation();
    const quarantineCmd = program.commands.find((command) => command.name() === "quarantine");
    const quarantineSuggestHelp = quarantineCmd?.commands.find((command) => command.name() === "suggest")?.helpInformation();
    const quarantineApplyHelp = quarantineCmd?.commands.find((command) => command.name() === "apply")?.helpInformation();
    const opsCmd = program.commands.find((command) => command.name() === "ops");
    const opsDailyHelp = opsCmd?.commands.find((command) => command.name() === "daily")?.helpInformation();
    const opsIncidentHelp = opsCmd?.commands.find((command) => command.name() === "incident")?.helpInformation();
    const opsWeeklyHelp = opsCmd?.commands.find((command) => command.name() === "weekly")?.helpInformation();
    const analyzeCmd = program.commands.find((command) => command.name() === "analyze");
    const evalHelp = analyzeCmd?.commands.find((command) => command.name() === "eval")?.helpInformation();
    const bundleHelp = analyzeCmd?.commands.find((command) => command.name() === "bundle")?.helpInformation();
    const flakyTagHelp = analyzeCmd?.commands.find((command) => command.name() === "flaky-tag")?.helpInformation();
    const importCmd = program.commands.find((command) => command.name() === "import");
    const importReportHelp = importCmd?.commands.find((command) => command.name() === "report")?.helpInformation();

    expect(runHelp).toContain("--dry-run");
    expect(runHelp).toContain("--explain");
    expect(runHelp).toContain("--gate");
    expect(runHelp).toContain("--cluster-mode");
    expect(runHelp).toContain("--skip-flaky-tagged");
    expect(gateReviewHelp).toContain("--window-days");
    expect(gateReviewHelp).toContain("--json");
    expect(gateExplainHelp).toContain("--json");
    expect(gateHistoryHelp).toContain("--window-days");
    expect(quarantineSuggestHelp).toContain("--window-days");
    expect(quarantineSuggestHelp).toContain("--output");
    expect(quarantineApplyHelp).toContain("--from");
    expect(quarantineApplyHelp).toContain("--create-issues");
    expect(opsDailyHelp).toContain("--window-days");
    expect(opsDailyHelp).toContain("--json");
    expect(opsIncidentHelp).toContain("--suite");
    expect(opsIncidentHelp).toContain("--test");
    expect(opsIncidentHelp).toContain("--run");
    expect(opsWeeklyHelp).toContain("--window-days");
    expect(opsWeeklyHelp).toContain("--json");
    expect(evalHelp).toContain("Measure whether local sampled runs predict CI");
    expect(bundleHelp).toContain("AI consumers");
    expect(bundleHelp).toContain("--window-days");
    expect(flakyTagHelp).toContain("--remove-after-passes");
    expect(importReportHelp).toContain("--source");
  });
});
