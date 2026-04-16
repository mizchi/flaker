import { describe, expect, it } from "vitest";
import { createProgram } from "../../src/cli/main.js";

describe("CLI help", () => {
  it("shows getting started guide in root help", () => {
    const program = createProgram();

    const help = program.helpInformation();

    expect(help).toContain("Intelligent test selection");
    expect(help).toContain("Getting started");
    expect(help).toContain("flaker init");
    expect(help).toContain("flaker collect calibrate");
    expect(help).toContain("Commands (by category)");
  });

  it("shows exec run help with --dry-run and --explain flags", () => {
    const program = createProgram();
    const execCmd = program.commands.find((command) => command.name() === "exec");
    const runCmd = execCmd?.commands.find((command) => command.name() === "run");
    const runHelp = runCmd?.helpInformation();
    const analyzeCmd = program.commands.find((command) => command.name() === "analyze");
    const evalHelp = analyzeCmd?.commands.find((command) => command.name() === "eval")?.helpInformation();
    const bundleHelp = analyzeCmd?.commands.find((command) => command.name() === "bundle")?.helpInformation();
    const flakyTagHelp = analyzeCmd?.commands.find((command) => command.name() === "flaky-tag")?.helpInformation();
    const importCmd = program.commands.find((command) => command.name() === "import");
    const importReportHelp = importCmd?.commands.find((command) => command.name() === "report")?.helpInformation();

    expect(runHelp).toContain("--dry-run");
    expect(runHelp).toContain("--explain");
    expect(runHelp).toContain("--cluster-mode");
    expect(runHelp).toContain("--skip-flaky-tagged");
    expect(evalHelp).toContain("Measure whether local sampled runs predict CI");
    expect(bundleHelp).toContain("AI consumers");
    expect(bundleHelp).toContain("--window-days");
    expect(flakyTagHelp).toContain("--remove-after-passes");
    expect(importReportHelp).toContain("--source");
  });
});
