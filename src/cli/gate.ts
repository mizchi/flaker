export type GateName = "iteration" | "merge" | "release";

export const VALID_GATE_NAMES: readonly GateName[] = ["iteration", "merge", "release"] as const;

/** 0.12 profile names, kept only to point users at the replacement gate. */
export const LEGACY_PROFILE_TO_GATE: Readonly<Record<string, GateName>> = {
  local: "iteration",
  ci: "merge",
  scheduled: "release",
};

export function normalizeGateName(name: string): GateName | undefined {
  const normalized = name.trim().toLowerCase();
  if (normalized === "iteration" || normalized === "merge" || normalized === "release") {
    return normalized;
  }
  return undefined;
}
