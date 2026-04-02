import { readFileSync } from "node:fs";
import { loadCore } from "../core/loader.js";
import {
  buildAffectedReport,
  createAffectedSelection,
} from "./affected-report.js";
import {
  buildBitflowDependents,
  matchBitflowTaskPaths,
  parseBitflowWorkflowTasks,
} from "./bitflow-workflow.js";
import type {
  AffectedReport,
  AffectedTarget,
  DependencyResolver,
} from "./types.js";

export class BitflowNativeResolver implements DependencyResolver {
  private workflowText: string;

  constructor(configPath: string) {
    this.workflowText = readFileSync(configPath, "utf-8");
  }

  async resolve(changedFiles: string[], allTestFiles: string[]): Promise<string[]> {
    const core = await loadCore();
    const affectedTargets = core.resolveAffected(this.workflowText, changedFiles);
    const testSet = new Set(allTestFiles);
    return affectedTargets.filter((target) => testSet.has(target));
  }

  explain(changedFiles: string[], targets: AffectedTarget[]): AffectedReport {
    const tasks = parseBitflowWorkflowTasks(this.workflowText);
    const directMatches = new Map<
      string,
      { matchedPaths: string[]; matchReasons: string[] }
    >();
    const unmatched = new Set(changedFiles);

    for (const task of tasks) {
      const result = matchBitflowTaskPaths(task, changedFiles);
      if (result.matchedPaths.length === 0) continue;

      directMatches.set(task.id, result);
      for (const matchedPath of result.matchedPaths) {
        unmatched.delete(matchedPath);
      }
    }

    const dependents = buildBitflowDependents(tasks);
    const includedBy = new Map<string, Set<string>>();
    const affected = new Set(directMatches.keys());
    const queue = [...directMatches.keys()];

    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      for (const dependent of dependents.get(current) ?? []) {
        let parents = includedBy.get(dependent);
        if (!parents) {
          parents = new Set<string>();
          includedBy.set(dependent, parents);
        }
        parents.add(current);

        if (!affected.has(dependent)) {
          affected.add(dependent);
          queue.push(dependent);
        }
      }
    }

    const targetsByTaskId = new Map<string, AffectedTarget[]>();
    for (const target of targets) {
      const existing = targetsByTaskId.get(target.taskId);
      if (existing) {
        existing.push(target);
      } else {
        targetsByTaskId.set(target.taskId, [target]);
      }
    }

    const selected = [...affected].flatMap((taskId) => {
      const matchedTargets = targetsByTaskId.get(taskId) ?? [];
      const direct = directMatches.has(taskId);
      const parents = [...(includedBy.get(taskId) ?? [])].sort();
      const directMatch = directMatches.get(taskId);

      return matchedTargets.map((target) =>
        createAffectedSelection(target, {
          direct,
          includedBy: direct ? [] : parents,
          matchedPaths: direct ? (directMatch?.matchedPaths ?? []) : [],
          matchReasons: direct
            ? (directMatch?.matchReasons ?? [])
            : parents.map((parent) => `dependency:${parent}`),
        }),
      );
    });

    return buildAffectedReport(
      "bitflow",
      changedFiles,
      selected,
      [...unmatched],
    );
  }
}
