import {
  buildAffectedReport,
  createAffectedSelection,
} from "./affected-report.js";
import type {
  AffectedReport,
  AffectedTarget,
  DependencyResolver,
} from "./types.js";

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function toChangedDir(file: string): string {
  const stripped = normalizePath(file).replace(/^src\//, "");
  const parts = stripped.split("/");
  parts.pop();
  return parts.join("/");
}

function toTargetDir(spec: string): string {
  return normalizePath(spec).replace(/^tests\//, "").split("/").slice(0, -1).join("/");
}

function toDirectoryReason(dir: string): string {
  return `directory:${dir ? `src/${dir}` : "src"}`;
}

export class SimpleResolver implements DependencyResolver {
  resolve(changedFiles: string[], allTestFiles: string[]): string[] {
    const changedDirs = changedFiles.map(toChangedDir);

    return allTestFiles.filter((testFile) => {
      const testDir = toTargetDir(testFile);

      return changedDirs.some((changedDir) => {
        return testDir === changedDir || testDir.startsWith(changedDir + "/");
      });
    });
  }

  explain(changedFiles: string[], targets: AffectedTarget[]): AffectedReport {
    const matchedFiles = new Set<string>();
    const selected = targets.flatMap((target) => {
      const targetDir = toTargetDir(target.spec);
      const directMatches = changedFiles.filter((file) => {
        const changedDir = toChangedDir(file);
        return (
          targetDir === changedDir || targetDir.startsWith(changedDir + "/")
        );
      });

      if (directMatches.length === 0) {
        return [];
      }

      for (const file of directMatches) {
        matchedFiles.add(file);
      }

      return [
        createAffectedSelection(target, {
          direct: true,
          matchedPaths: directMatches,
          matchReasons: Array.from(
            new Set(directMatches.map((file) => toDirectoryReason(toChangedDir(file)))),
          ),
        }),
      ];
    });

    return buildAffectedReport(
      "simple",
      changedFiles,
      selected,
      changedFiles.filter((file) => !matchedFiles.has(file)),
    );
  }
}
