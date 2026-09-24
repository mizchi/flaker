import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/cli/config.js";
import { resolveGateName, resolveGate } from "../../src/cli/gate-config.js";

function configDir(toml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "flaker-gate-"));
  writeFileSync(join(dir, "flaker.toml"), `[repo]\nowner = "a"\nname = "b"\n${toml}`);
  return dir;
}

// Top-level keys must come before any [table] header to stay top-level.
function configDirTopLevel(toml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "flaker-gate-"));
  writeFileSync(join(dir, "flaker.toml"), `${toml}[repo]\nowner = "a"\nname = "b"\n`);
  return dir;
}

describe("resolveGateName", () => {
  it("prefers the explicit gate", () => {
    expect(resolveGateName("release", {})).toBe("release");
  });
  it("reads FLAKER_GATE", () => {
    expect(resolveGateName(undefined, { FLAKER_GATE: "merge" })).toBe("merge");
  });
  it("defaults to merge on CI and iteration elsewhere", () => {
    expect(resolveGateName(undefined, { CI: "true" })).toBe("merge");
    expect(resolveGateName(undefined, { GITHUB_ACTIONS: "true" })).toBe("merge");
    expect(resolveGateName(undefined, {})).toBe("iteration");
  });
  it("rejects FLAKER_PROFILE with the replacement", () => {
    expect(() => resolveGateName(undefined, { FLAKER_PROFILE: "ci" })).toThrow(
      /FLAKER_PROFILE was replaced by FLAKER_GATE.*ci → merge/,
    );
  });
  it("rejects an unknown gate", () => {
    expect(() => resolveGateName("ci", {})).toThrow(/Unknown gate 'ci'/);
  });
});

describe("[gate.*] config", () => {
  it("reads [gate.merge] into the merge gate", () => {
    const config = loadConfig(configDir(`[gate.merge]\nstrategy = "hybrid"\nsample_percentage = 30\n`));
    const gate = resolveGate("merge", config.gate, config.sampling);
    expect(gate.name).toBe("merge");
    expect(gate.strategy).toBe("hybrid");
    expect(gate.sample_percentage).toBe(30);
  });

  it("rejects [profile.*] and names the [gate.*] section", () => {
    expect(() => loadConfig(configDir(`[profile.ci]\nstrategy = "hybrid"\n`))).toThrow(
      /\[profile\.ci\] was renamed to \[gate\.merge\]/,
    );
  });

  it("rejects custom profile names", () => {
    expect(() => loadConfig(configDir(`[profile.nightly]\nstrategy = "full"\n`))).toThrow(
      /\[profile\.nightly\] has no gate equivalent/,
    );
  });

  it("rejects unknown gate sections", () => {
    expect(() => loadConfig(configDir(`[gate.nightly]\nstrategy = "full"\n`))).toThrow(
      /\[gate\.nightly\] is not a gate/,
    );
  });
});

describe("malformed gate config", () => {
  it("rejects gate sections that differ only in case", () => {
    expect(() => loadConfig(configDir(`[gate.Merge]\nstrategy = "full"\n`))).toThrow(
      /\[gate\.Merge\] is not a gate/,
    );
  });

  it.each([
    ["gate = 5\n", /`gate` must be a table/],
    ['gate = "x"\n', /`gate` must be a table/],
    ["gate = [1]\n", /`gate` must be a table/],
    ['[gate]\nmerge = "x"\n', /`gate\.merge` must be a table \(\[gate\.merge\]\)/],
    ["[gate]\nmerge = [1]\n", /`gate\.merge` must be a table \(\[gate\.merge\]\)/],
  ])("rejects non-table gate value %j", (toml, pattern) => {
    expect(() => loadConfig(configDirTopLevel(toml))).toThrow(pattern);
  });

  it.each([
    ['profile = "x"\n'],
    ["profile = {}\n"],
    ["[profile]\n"],
    ["profile = [1]\n"],
  ])("rejects any profile key %j", (toml) => {
    expect(() => loadConfig(configDirTopLevel(toml))).toThrow(
      /\[profile\] is no longer supported; use \[gate\.iteration\], \[gate\.merge\], \[gate\.release\]/,
    );
  });

  it("rejects [profile.ci] even when [gate.merge] is also present", () => {
    expect(() =>
      loadConfig(configDir(`[gate.merge]\nstrategy = "hybrid"\n[profile.ci]\nstrategy = "hybrid"\n`)),
    ).toThrow(/\[profile\.ci\] was renamed to \[gate\.merge\]/);
  });
});

describe("blank env vars", () => {
  it("treats blank FLAKER_GATE as unset", () => {
    expect(resolveGateName(undefined, { FLAKER_GATE: "" })).toBe("iteration");
    expect(resolveGateName(undefined, { FLAKER_GATE: "   ", CI: "true" })).toBe("merge");
  });

  it("treats blank FLAKER_PROFILE as unset", () => {
    expect(resolveGateName(undefined, { FLAKER_PROFILE: "" })).toBe("iteration");
    expect(resolveGateName("release", { FLAKER_PROFILE: "  " })).toBe("release");
  });
});
