import type { DependencyResolver } from "./types.js";

export class SimpleResolver implements DependencyResolver {
  resolve(changedFiles: string[], allTestFiles: string[]): string[] {
    const changedDirs = changedFiles.map((f) => {
      // Strip "src/" prefix and get directory path
      const stripped = f.replace(/^src\//, "");
      const parts = stripped.split("/");
      parts.pop(); // remove filename
      return parts.join("/");
    });

    return allTestFiles.filter((testFile) => {
      // Strip "tests/" prefix and get directory path
      const stripped = testFile.replace(/^tests\//, "");
      const testDir = stripped.split("/").slice(0, -1).join("/");

      return changedDirs.some((changedDir) => {
        // Match if the test file's directory starts with the changed file's directory
        return testDir === changedDir || testDir.startsWith(changedDir + "/");
      });
    });
  }
}
