import { describe, it, expect } from "vitest";
import { parseGitDiffTree, resolveCommitChanges } from "../../src/cli/core/git.js";

describe("parseGitDiffTree", () => {
  it("parses name-status output", () => {
    const output = "M\tsrc/foo.ts\nA\tsrc/bar.ts\nD\tsrc/old.ts\n";
    const result = parseGitDiffTree(output);
    expect(result).toEqual([
      { filePath: "src/foo.ts", changeType: "modified", additions: 0, deletions: 0 },
      { filePath: "src/bar.ts", changeType: "added", additions: 0, deletions: 0 },
      { filePath: "src/old.ts", changeType: "deleted", additions: 0, deletions: 0 },
    ]);
  });

  it("handles rename status", () => {
    const output = "R100\told/path.ts\tnew/path.ts\n";
    const result = parseGitDiffTree(output);
    expect(result).toEqual([
      { filePath: "new/path.ts", changeType: "renamed", additions: 0, deletions: 0 },
    ]);
  });

  it("handles empty output", () => {
    expect(parseGitDiffTree("")).toEqual([]);
    expect(parseGitDiffTree("\n")).toEqual([]);
  });
});

describe("resolveCommitChanges", () => {
  it("returns changes for HEAD commit", () => {
    const changes = resolveCommitChanges(process.cwd(), "HEAD");
    expect(changes).not.toBeNull();
    if (changes) {
      expect(changes.length).toBeGreaterThan(0);
      expect(changes[0]).toHaveProperty("filePath");
      expect(changes[0]).toHaveProperty("changeType");
    }
  });

  it("returns null for invalid sha", () => {
    const changes = resolveCommitChanges(process.cwd(), "0000000000000000000000000000000000000000");
    expect(changes).toBeNull();
  });
});
