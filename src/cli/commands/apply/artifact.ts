import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { PlannedAction } from "./planner.js";
import type { DagExecutedAction } from "./dag.js";
import type { StateDiff } from "./state.js";
import type { RepoProbe } from "./planner.js";

export interface PlanArtifact {
  generatedAt: string;
  diff: StateDiff;
  actions: PlannedAction[];
  probe: RepoProbe;
}

export interface ApplyArtifact {
  generatedAt: string;
  diff: StateDiff;
  actions: PlannedAction[];
  executed: DagExecutedAction[];
  probe: RepoProbe;
  emitted?: EmittedArtifact;
}

export type EmitKind = "daily" | "weekly" | "incident";

export interface EmittedArtifact {
  kind: EmitKind;
  report: unknown;
}

export function serializePlanArtifact(artifact: PlanArtifact): string {
  return JSON.stringify(artifact, null, 2);
}

export function serializeApplyArtifact(artifact: ApplyArtifact): string {
  return JSON.stringify(artifact, null, 2);
}

export function writeArtifact(path: string, content: string): void {
  const target = resolve(process.cwd(), path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}
