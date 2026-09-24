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

export function deserializePlanArtifact(json: string): PlanArtifact {
  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid plan artifact: expected JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.generatedAt !== "string") throw new Error("Invalid plan artifact: missing generatedAt");
  if (!obj.diff || typeof obj.diff !== "object") throw new Error("Invalid plan artifact: missing diff");
  if (!Array.isArray(obj.actions)) throw new Error("Invalid plan artifact: missing actions");
  if (!obj.probe || typeof obj.probe !== "object") throw new Error("Invalid plan artifact: missing probe");
  return obj as unknown as PlanArtifact;
}
