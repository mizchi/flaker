import { describe, it, expect } from "vitest";
import { runDoctor, formatDoctorReport } from "../../src/cli/commands/debug/doctor.js";

describe("runDoctor", () => {
  it("reports success when all checks pass", async () => {
    const report = await runDoctor(process.cwd(), {
      canLoadConfig: () => true,
      hasMoonBitBuild: async () => false,
      createStore: () => ({
        initialize: async () => {},
        close: async () => {},
      }),
    });

    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.name === "config")?.ok).toBe(true);
    expect(report.checks.find((c) => c.name === "duckdb")?.ok).toBe(true);
    expect(report.checks.find((c) => c.name === "moonbit")?.detail).toContain("TypeScript fallback");
  });

  it("reports failure when duckdb cannot initialize", async () => {
    const report = await runDoctor(process.cwd(), {
      canLoadConfig: () => true,
      hasMoonBitBuild: async () => true,
      createStore: () => ({
        initialize: async () => {
          throw new Error("duckdb missing");
        },
        close: async () => {},
      }),
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "duckdb")?.ok).toBe(false);
    expect(formatDoctorReport(report)).toContain("Doctor checks failed.");
  });

  it("shows config threshold warnings without failing doctor", async () => {
    const report = await runDoctor(process.cwd(), {
      canLoadConfig: () => true,
      hasMoonBitBuild: async () => true,
      createStore: () => ({
        initialize: async () => {},
        close: async () => {},
      }),
      getConfigWarnings: () => [
        "quarantine.flaky_rate_threshold=0.3 looks like a legacy ratio; interpreted as 30%",
      ],
    });

    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.name === "config")?.warnings).toEqual([
      "quarantine.flaky_rate_threshold=0.3 looks like a legacy ratio; interpreted as 30%",
    ]);
    expect(formatDoctorReport(report)).toContain("WARN  quarantine.flaky_rate_threshold=0.3");
  });
});

describe("formatDoctorReport config remediation", () => {
  const report = (detail: string) => ({
    ok: false,
    checks: [{ name: "config", ok: false, detail }],
  });

  it("suggests flaker init only when the config file is missing", () => {
    const out = formatDoctorReport(report("Config file not found: /x/flaker.toml. Run 'flaker init' to create one."));
    expect(out).toContain("flaker init");
  });

  it("points at the migration guide, not flaker init, for removed or renamed keys", () => {
    const out = formatDoctorReport(
      report("flaker.toml uses removed or renamed keys (see docs/migration-0.12-to-0.13.md and docs/how-to-use.md#config-migration):\n  [profile.ci] was renamed to [gate.merge]"),
    );
    expect(out).not.toContain("flaker init");
    expect(out).toContain("Fix each key listed above");
  });

  it("gives no init hint for other config errors", () => {
    const out = formatDoctorReport(report("Invalid TOML at line 3"));
    expect(out).not.toContain("flaker init");
  });
});
