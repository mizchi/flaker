import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createResolver } from "../../src/cli/resolvers/index.js";
import { GlobRuleResolver } from "../../src/cli/resolvers/glob.js";

describe("GlobRuleResolver", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function writeConfig(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), "flaker-glob-resolver-"));
    tempDirs.push(dir);
    const configPath = join(dir, "affected-rules.toml");
    writeFileSync(configPath, content);
    return configPath;
  }

  it("maps changed files to suites through glob rules", () => {
    const resolver = new GlobRuleResolver(
      writeConfig(`
[[rules]]
changed = ["src/cmd/bit/merge*.mbt", "src/lib/merge*.mbt"]
select = ["third_party/git/t/t64*.sh", "third_party/git/t/t760*.sh"]
reason = "command:merge"
`),
    );

    const result = resolver.resolve(
      ["src/cmd/bit/merge.mbt"],
      [
        "third_party/git/t/t6400-merge-df.sh",
        "third_party/git/t/t7600-merge.sh",
        "third_party/git/t/t7508-status.sh",
      ],
    );

    expect(result).toEqual([
      "third_party/git/t/t6400-merge-df.sh",
      "third_party/git/t/t7600-merge.sh",
    ]);
  });

  it("dedupes suites selected by multiple matching rules", () => {
    const configPath = writeConfig(`
[[rules]]
changed = ["src/cmd/bit/fetch*.mbt"]
select = ["third_party/git/t/t55*.sh"]
reason = "command:fetch"

[[rules]]
changed = ["src/protocol/**"]
select = ["third_party/git/t/t55*.sh", "third_party/git/t/t57*.sh"]
reason = "protocol"
`);
    const resolver = createResolver(
      { resolver: "glob", config: configPath },
      process.cwd(),
    );

    const result = resolver.resolve(
      ["src/cmd/bit/fetch.mbt", "src/protocol/transport.mbt"],
      [
        "third_party/git/t/t5500-fetch-pack.sh",
        "third_party/git/t/t5510-fetch.sh",
        "third_party/git/t/t5700-protocol-v1.sh",
      ],
    );

    expect(result).toEqual([
      "third_party/git/t/t5500-fetch-pack.sh",
      "third_party/git/t/t5510-fetch.sh",
      "third_party/git/t/t5700-protocol-v1.sh",
    ]);
  });

  it("explains selected suites, reasons, and unmatched files", async () => {
    const resolver = new GlobRuleResolver(
      writeConfig(`
[[rules]]
changed = ["src/cmd/bit/config*.mbt", "src/lib/remote_config*.mbt"]
select = ["third_party/git/t/t1300-config.sh"]
reason = "command:config"

[[rules]]
changed = ["src/cmd/bit/remote*.mbt", "src/lib/remote_*.mbt"]
select = ["third_party/git/t/t55*.sh", "third_party/git/t/t57*.sh"]
reason = "command:remote"
`),
    );

    const report = await resolver.explain?.(
      [
        "src/cmd/bit/config.mbt",
        "src/cmd/bit/config_wbtest.mbt",
        "src/misc/readme.md",
      ],
      [
        {
          spec: "third_party/git/t/t1300-config.sh",
          taskId: "git-compat",
          filter: null,
        },
        {
          spec: "third_party/git/t/t5505-remote.sh",
          taskId: "git-compat",
          filter: null,
        },
      ],
    );

    expect(report?.matched).toHaveLength(1);
    expect(report?.selected).toEqual([
      expect.objectContaining({
        spec: "third_party/git/t/t1300-config.sh",
        taskId: "git-compat",
        direct: true,
        matchedPaths: [
          "src/cmd/bit/config.mbt",
          "src/cmd/bit/config_wbtest.mbt",
        ],
        matchReasons: ["command:config"],
      }),
    ]);
    expect(report?.unmatched).toEqual(["src/misc/readme.md"]);
  });
});
