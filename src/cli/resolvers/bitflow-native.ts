import { readFileSync } from "node:fs";
import { loadCore } from "../core/loader.js";
import type { DependencyResolver } from "./types.js";

export class BitflowNativeResolver implements DependencyResolver {
  private workflowText: string;

  constructor(configPath: string) {
    this.workflowText = readFileSync(configPath, "utf-8");
  }

  async resolve(changedFiles: string[], allTestFiles: string[]): Promise<string[]> {
    const core = await loadCore();
    const affectedTargets = core.resolveAffected(this.workflowText, changedFiles);
    // Filter against known test files
    const testSet = new Set(allTestFiles);
    return affectedTargets.filter(t => testSet.has(t));
  }
}
